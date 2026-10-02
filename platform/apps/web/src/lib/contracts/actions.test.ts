import { describe, expect, it, vi } from "vitest";
import { createContractActions } from "./actions";
import { DuplicateError, InvalidInputError, LimitError, NotAllowedError } from "../marketplace/errors";
import type { Approval } from "./db";

const U = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const approval: Approval = {
  payment_id: U(50), milestone_id: U(3), contract_id: U(2), title: "First milestone", amount: 40000, client_fee: 800,
  provider_fee: 2000, client_total: 40800, application_fee: 2800, currency: "USD", previous_session: null,
};

function setup(over: { user?: { userId: string } | null; allow?: boolean } = {}) {
  const db = {
    hire: vi.fn(async () => U(9)), setMilestones: vi.fn(async () => undefined), acceptContract: vi.fn(async () => undefined),
    activateContract: vi.fn(async () => undefined), submitMilestone: vi.fn(async () => undefined), requestChanges: vi.fn(async () => undefined),
    cancelContract: vi.fn(async () => undefined), approveMilestone: vi.fn(async () => approval), raiseDispute: vi.fn(async () => U(8)),
    postReview: vi.fn(async () => U(7)), assertCanManagePayouts: vi.fn(async () => undefined),
  };
  const service = {
    paymentDestination: vi.fn(async () => "acct_dest"), attachCheckoutSession: vi.fn(async (_p: string, _s: string, _prev: string | null) => true),
    payoutAccount: vi.fn(async () => null as string | null), registerConnectedAccount: vi.fn(async () => undefined),
  };
  const provider = {
    createCheckout: vi.fn(async () => ({ sessionId: "cs_new", url: "https://checkout.example/cs_new" })),
    expireCheckout: vi.fn(async (_s: string): Promise<"expired" | "complete"> => "expired"),
    createOnboardingLink: vi.fn(async () => ({ account: "acct_new", url: "https://connect.example/go" })),
  };
  const auth = vi.fn(async () => (over.user === undefined ? { userId: "user-1" } : over.user));
  const throttle = vi.fn(async () => over.allow ?? true);
  const revalidate = vi.fn();
  const actions = createContractActions({ db, service, provider, auth, throttle, revalidate, appUrl: () => "https://papple.test", expiryMinutes: async () => 60 });
  return { actions, db, service, provider, auth, throttle, revalidate };
}

describe("contract actions: shared behaviour", () => {
  it("rejects invalid input before authenticating", async () => {
    const { actions, auth, db } = setup();
    expect(await actions.hire({ orgId: "nope" })).toEqual({ ok: false, code: "invalid" });
    expect(auth).not.toHaveBeenCalled();
    expect(db.hire).not.toHaveBeenCalled();
  });
  it("refuses signed-out callers", async () => {
    const { actions, db } = setup({ user: null });
    expect(await actions.hire({ orgId: U(1), proposalId: U(2), projectId: U(3) })).toEqual({ ok: false, code: "forbidden" });
    expect(db.hire).not.toHaveBeenCalled();
  });
  it("refuses throttled callers", async () => {
    const { actions, db } = setup({ allow: false });
    expect(await actions.hire({ orgId: U(1), proposalId: U(2), projectId: U(3) })).toEqual({ ok: false, code: "rate" });
    expect(db.hire).not.toHaveBeenCalled();
  });
  it.each([
    [new NotAllowedError(), "forbidden"], [new InvalidInputError(), "invalid"], [new LimitError(), "limit"],
    [new DuplicateError(), "duplicate"], [new Error("db exploded with secrets"), "error"],
  ])("maps %s to %s without leaking text", async (err, code) => {
    const { actions, db } = setup();
    db.hire.mockRejectedValueOnce(err);
    const r = await actions.hire({ orgId: U(1), proposalId: U(2), projectId: U(3) });
    expect(r).toEqual({ ok: false, code });
  });
  it("hire returns the contract id and revalidates both pages", async () => {
    const { actions, revalidate } = setup();
    expect(await actions.hire({ orgId: U(1), proposalId: U(2), projectId: U(3) })).toEqual({ ok: true, id: U(9) });
    expect(revalidate.mock.calls).toEqual([[`/contracts/${U(9)}`], [`/projects/${U(3)}`]]);
  });
  it("validates milestone amounts and money-like inputs", async () => {
    const { actions } = setup();
    expect((await actions.setMilestones({ orgId: U(1), contractId: U(2), items: [{ title: "A", amount: 10.5 }] })).ok).toBe(false);
    expect((await actions.postReview({ orgId: U(1), contractId: U(2), rating: 6 })).ok).toBe(false);
    expect((await actions.raiseDispute({ orgId: U(1), contractId: U(2), reason: "short" })).ok).toBe(false);
  });
  it("passes milestone submissions through with the contract path revalidated", async () => {
    const { actions, db, revalidate } = setup();
    expect(await actions.submitMilestone({ orgId: U(1), contractId: U(2), milestoneId: U(3) })).toEqual({ ok: true, id: undefined });
    expect(db.submitMilestone).toHaveBeenCalledWith(U(1), U(3));
    expect(revalidate).toHaveBeenCalledWith(`/contracts/${U(2)}`);
  });
});

describe("approveAndPay", () => {
  const input = { orgId: U(1), contractId: U(2), milestoneId: U(3) };
  it("approves, opens a destination-charge checkout and returns its url", async () => {
    const { actions, db, service, provider, throttle } = setup();
    const r = await actions.approveAndPay(input);
    expect(r).toEqual({ ok: true, url: "https://checkout.example/cs_new" });
    expect(throttle).toHaveBeenCalledWith("checkout", "checkout:user-1");
    expect(db.approveMilestone).toHaveBeenCalledWith(U(1), U(3));
    expect(service.paymentDestination).toHaveBeenCalledWith(U(50));
    expect(provider.createCheckout).toHaveBeenCalledWith({
      paymentId: U(50), totalMinor: 40800, applicationFeeMinor: 2800, currency: "USD", destinationAccount: "acct_dest",
      title: "First milestone", successUrl: `https://papple.test/contracts/${U(2)}?paid=1`, cancelUrl: `https://papple.test/contracts/${U(2)}`, expiresInMinutes: 60,
    });
    expect(service.attachCheckoutSession).toHaveBeenCalledWith(U(50), "cs_new", null);
  });
  it("never reaches the payment provider when approval is refused", async () => {
    const { actions, db, provider, service } = setup();
    db.approveMilestone.mockRejectedValueOnce(new NotAllowedError());
    expect(await actions.approveAndPay(input)).toEqual({ ok: false, code: "forbidden" });
    expect(provider.createCheckout).not.toHaveBeenCalled();
    expect(service.paymentDestination).not.toHaveBeenCalled();
  });
  it("expires the previous checkout session on a retry and attaches the new one against it", async () => {
    const { actions, db, provider, service } = setup();
    db.approveMilestone.mockResolvedValueOnce({ ...approval, previous_session: "cs_old" });
    expect((await actions.approveAndPay(input)).ok).toBe(true);
    expect(provider.expireCheckout).toHaveBeenCalledWith("cs_old");
    expect(service.attachCheckoutSession).toHaveBeenCalledWith(U(50), "cs_new", "cs_old");
  });
  it("never opens a second checkout when the previous one was already paid", async () => {
    const { actions, db, provider } = setup();
    db.approveMilestone.mockResolvedValueOnce({ ...approval, previous_session: "cs_old" });
    provider.expireCheckout.mockResolvedValueOnce("complete");
    expect(await actions.approveAndPay(input)).toEqual({ ok: false, code: "duplicate" });
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });
  it("fails closed when the previous session cannot be expired", async () => {
    const { actions, db, provider } = setup();
    db.approveMilestone.mockResolvedValueOnce({ ...approval, previous_session: "cs_old" });
    provider.expireCheckout.mockRejectedValueOnce(new Error("stripe down"));
    expect(await actions.approveAndPay(input)).toEqual({ ok: false, code: "error" });
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });
  it("expires its own session and reports a duplicate when a concurrent click attached first", async () => {
    const { actions, provider, service } = setup();
    service.attachCheckoutSession.mockResolvedValueOnce(false);
    expect(await actions.approveAndPay(input)).toEqual({ ok: false, code: "duplicate" });
    expect(provider.expireCheckout).toHaveBeenCalledWith("cs_new");
  });
  it("leaves the payment retryable when the provider fails", async () => {
    const { actions, provider, service } = setup();
    provider.createCheckout.mockRejectedValueOnce(new Error("stripe down"));
    expect(await actions.approveAndPay(input)).toEqual({ ok: false, code: "error" });
    expect(service.attachCheckoutSession).not.toHaveBeenCalled();
  });
  it("revalidates the contract page", async () => {
    const { actions, revalidate } = setup();
    await actions.approveAndPay(input);
    expect(revalidate).toHaveBeenCalledWith(`/contracts/${U(2)}`);
  });
});

describe("startPayoutOnboarding", () => {
  it("checks the role first and refuses without calling the provider", async () => {
    const { actions, db, provider } = setup();
    db.assertCanManagePayouts.mockRejectedValueOnce(new NotAllowedError());
    expect(await actions.startPayoutOnboarding({ orgId: U(1) })).toEqual({ ok: false, code: "forbidden" });
    expect(provider.createOnboardingLink).not.toHaveBeenCalled();
  });
  it("registers a newly created account and returns the onboarding link", async () => {
    const { actions, service, provider } = setup();
    const r = await actions.startPayoutOnboarding({ orgId: U(1) });
    expect(r).toEqual({ ok: true, url: "https://connect.example/go" });
    expect(provider.createOnboardingLink).toHaveBeenCalledWith({ account: undefined, returnUrl: "https://papple.test/settings/payouts?return=1", refreshUrl: "https://papple.test/settings/payouts?refresh=1" });
    expect(service.registerConnectedAccount).toHaveBeenCalledWith(U(1), "acct_new");
  });
  it("reuses an existing account without registering again", async () => {
    const { actions, service, provider } = setup();
    service.payoutAccount.mockResolvedValueOnce("acct_old");
    provider.createOnboardingLink.mockResolvedValueOnce({ account: "acct_old", url: "https://connect.example/again" });
    await actions.startPayoutOnboarding({ orgId: U(1) });
    expect(provider.createOnboardingLink).toHaveBeenCalledWith(expect.objectContaining({ account: "acct_old" }));
    expect(service.registerConnectedAccount).not.toHaveBeenCalled();
  });
});
