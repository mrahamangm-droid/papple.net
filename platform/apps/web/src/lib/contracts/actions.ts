import type { ZodType } from "zod";
import { DuplicateError, InvalidInputError, LimitError, NotAllowedError } from "../marketplace/errors";
import type { RULES } from "../ratelimit";
import type { ContractsDb } from "./db";
import type { AcceptOutcome } from "../approvals/present";
import type { PaymentsServiceDb } from "../payments/service-db";
import type { PaymentProvider } from "../payments/provider";
import {
  activateInput, cancelInput, contractRef, disputeInput, hireInput, milestoneRef, payoutInput, requestChangesInput, reviewInput, setMilestonesInput,
} from "./validators";

export type ContractActionResult =
  | { ok: true; id?: string; url?: string; outcome?: AcceptOutcome }
  | { ok: false; code: "forbidden" | "invalid" | "limit" | "duplicate" | "rate" | "error" };

interface Deps {
  db: ContractsDb;
  service: Pick<PaymentsServiceDb, "paymentDestination" | "attachCheckoutSession" | "payoutAccount" | "registerConnectedAccount">;
  provider: Pick<PaymentProvider, "createCheckout" | "expireCheckout" | "createOnboardingLink">;
  auth: () => Promise<{ userId: string } | null>;
  throttle: (rule: keyof typeof RULES, key: string) => Promise<boolean>;
  revalidate: (path: string) => void;
  appUrl: () => string;
  expiryMinutes: () => Promise<number>;
}

type Outcome = { id?: string; url?: string; outcome?: AcceptOutcome; paths: string[] };

/** Every action: parse -> authenticate -> per-user rate limit -> RPC(s) -> revalidate. Errors become codes, never raw text. */
export function createContractActions(deps: Deps) {
  async function run<S>(
    schema: ZodType<S>, input: unknown, rule: keyof typeof RULES, keyPrefix: string, exec: (v: S) => Promise<Outcome>,
  ): Promise<ContractActionResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const user = await deps.auth();
    if (!user) return { ok: false, code: "forbidden" };
    if (!(await deps.throttle(rule, `${keyPrefix}${user.userId}`))) return { ok: false, code: "rate" };
    try {
      const out = await exec(parsed.data);
      for (const path of out.paths) deps.revalidate(path); // explicit loop: forEach(fn) would pass the index as revalidatePath's 2nd argument
      return { ok: true, id: out.id, url: out.url, outcome: out.outcome } as ContractActionResult;
    } catch (e) {
      if (e instanceof NotAllowedError) return { ok: false, code: "forbidden" };
      if (e instanceof InvalidInputError) return { ok: false, code: "invalid" };
      if (e instanceof LimitError) return { ok: false, code: "limit" };
      if (e instanceof DuplicateError) return { ok: false, code: "duplicate" };
      return { ok: false, code: "error" };
    }
  }
  const page = (contractId: string) => [`/contracts/${contractId}`, "/contracts"];
  const site = () => deps.appUrl().replace(/\/$/, "");

  return {
    hire: (i: unknown) => run(hireInput, i, "contract", "contract:", async (v) => {
      const id = await deps.db.hire({ orgId: v.orgId, proposalId: v.proposalId });
      return { id, paths: [`/contracts/${id}`, `/projects/${v.projectId}`] };
    }),
    setMilestones: (i: unknown) => run(setMilestonesInput, i, "contract", "contract:", async (v) => {
      await deps.db.setMilestones(v);
      return { paths: page(v.contractId) };
    }),
    acceptContract: (i: unknown) => run(contractRef, i, "contract", "contract:", async (v) => {
      const outcome = await deps.db.acceptContract(v.orgId, v.contractId);
      return { outcome, paths: page(v.contractId) };
    }),
    activateContract: (i: unknown) => run(activateInput, i, "contract", "contract:", async (v) => {
      await deps.db.activateContract(v.contractId);
      return { paths: page(v.contractId) };
    }),
    cancelContract: (i: unknown) => run(cancelInput, i, "contract", "contract:", async (v) => {
      await deps.db.cancelContract(v.orgId, v.contractId, v.reason);
      return { paths: page(v.contractId) };
    }),
    submitMilestone: (i: unknown) => run(milestoneRef, i, "contract", "contract:", async (v) => {
      await deps.db.submitMilestone(v.orgId, v.milestoneId);
      return { paths: page(v.contractId) };
    }),
    requestChanges: (i: unknown) => run(requestChangesInput, i, "contract", "contract:", async (v) => {
      await deps.db.requestChanges(v.orgId, v.milestoneId, v.note);
      return { paths: page(v.contractId) };
    }),
    raiseDispute: (i: unknown) => run(disputeInput, i, "dispute", "dispute:", async (v) => {
      await deps.db.raiseDispute(v);
      return { paths: page(v.contractId) };
    }),
    postReview: (i: unknown) => run(reviewInput, i, "review", "review:", async (v) => {
      await deps.db.postReview(v);
      return { paths: page(v.contractId) };
    }),

    /** Approve (database decides who may and what is owed), then open a Checkout session for exactly that payment. */
    approveAndPay: (i: unknown) => run(milestoneRef, i, "checkout", "checkout:", async (v) => {
      const a = await deps.db.approveMilestone(v.orgId, v.milestoneId);
      // A stale open session must not be payable, and one the client already paid must never be answered with a second charge.
      if (a.previous_session && (await deps.provider.expireCheckout(a.previous_session)) === "complete") throw new DuplicateError();
      const destinationAccount = await deps.service.paymentDestination(a.payment_id);
      const session = await deps.provider.createCheckout({
        paymentId: a.payment_id, totalMinor: a.client_total, applicationFeeMinor: a.application_fee, currency: a.currency,
        destinationAccount, title: a.title,
        successUrl: `${site()}/contracts/${v.contractId}?paid=1`, cancelUrl: `${site()}/contracts/${v.contractId}`,
        expiresInMinutes: await deps.expiryMinutes(),
      });
      if (!(await deps.service.attachCheckoutSession(a.payment_id, session.sessionId, a.previous_session))) {
        // A concurrent click won the race: only one live session may exist.
        await deps.provider.expireCheckout(session.sessionId).catch(() => undefined);
        throw new DuplicateError();
      }
      return { url: session.url, paths: page(v.contractId) };
    }),

    startPayoutOnboarding: (i: unknown) => run(payoutInput, i, "checkout", "payout:", async (v) => {
      await deps.db.assertCanManagePayouts(v.orgId);
      const existing = (await deps.service.payoutAccount(v.orgId)) ?? undefined;
      const link = await deps.provider.createOnboardingLink({
        account: existing, returnUrl: `${site()}/settings/payouts?return=1`, refreshUrl: `${site()}/settings/payouts?refresh=1`,
      });
      if (!existing) await deps.service.registerConnectedAccount(v.orgId, link.account);
      return { url: link.url, paths: ["/settings/payouts"] };
    }),
  };
}
