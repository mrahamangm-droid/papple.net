import type { ZodType } from "zod";
import { DuplicateError, InvalidInputError, LimitError, NotAllowedError } from "./errors";
import type { MarketplaceDb } from "./db";
import { messageInput, profileInput, projectInput, proposalInput, reportInput, serviceInput } from "./validators";
import { z } from "zod";
import type { RULES } from "../ratelimit";

export type ActionResult = { ok: true; id?: string } | { ok: false; code: "forbidden" | "invalid" | "limit" | "duplicate" | "rate" | "error" };

interface Deps {
  db: Pick<MarketplaceDb, "upsertProfile" | "upsertService" | "upsertProject" | "submitProposal" | "setProposalStatus" | "setProjectStatus" | "withdrawProposal" | "markNotificationRead" | "startConversation" | "sendMessage" | "report">;
  auth: () => Promise<{ userId: string } | null>;
  throttle: (rule: keyof typeof RULES, key: string) => Promise<boolean>;
  revalidate: (path: string) => void;
}

const startThreadInput = z.object({
  fromOrgId: z.uuid(), kind: z.enum(["service", "profile", "project", "proposal"]), refId: z.uuid(),
  firstMessage: z.string().trim().min(1).max(4000),
});
const statusInput = z.object({ orgId: z.uuid(), id: z.uuid(), status: z.enum(["open", "closed", "cancelled"]) });
const withdrawInput = z.object({ orgId: z.uuid(), id: z.uuid(), projectId: z.uuid() });
const readInput = z.object({ id: z.uuid() });
const decideInput = z.object({ id: z.uuid(), projectId: z.uuid(), status: z.enum(["shortlisted", "declined"]) });

/** Every action: parse input -> authenticate -> per-user rate limit -> RPC -> revalidate. Errors become codes, never raw text. */
export function createActions(deps: Deps) {
  async function run<S, R>(
    schema: ZodType<S>, input: unknown, rule: keyof typeof RULES, keyPrefix: string,
    exec: (v: S) => Promise<R>, after: (v: S, r: R) => { id?: string; paths: string[] },
  ): Promise<ActionResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const user = await deps.auth();
    if (!user) return { ok: false, code: "forbidden" };
    if (!(await deps.throttle(rule, `${keyPrefix}${user.userId}`))) return { ok: false, code: "rate" };
    try {
      const out = after(parsed.data, await exec(parsed.data));
      for (const path of out.paths) deps.revalidate(path); // never forEach(fn): the index would become revalidatePath's 2nd arg
      return { ok: true, id: out.id };
    } catch (e) {
      if (e instanceof NotAllowedError) return { ok: false, code: "forbidden" };
      if (e instanceof InvalidInputError) return { ok: false, code: "invalid" };
      if (e instanceof LimitError) return { ok: false, code: "limit" };
      if (e instanceof DuplicateError) return { ok: false, code: "duplicate" };
      return { ok: false, code: "error" };
    }
  }
  const idOf = (r: unknown) => (typeof r === "string" ? r : undefined);
  // Content writes share the `message` bucket under a `write:` key so they cannot be spammed either.
  return {
    saveProfile: (i: unknown) => run(profileInput, i, "message", "write:", deps.db.upsertProfile, (_v, r) => ({ id: idOf(r), paths: ["/profile"] })),
    saveService: (i: unknown) => run(serviceInput, i, "message", "write:", deps.db.upsertService, (_v, r) => ({ id: idOf(r), paths: ["/services"] })),
    saveProject: (i: unknown) => run(projectInput, i, "message", "write:", deps.db.upsertProject, (_v, r) => ({ id: idOf(r), paths: ["/projects"] })),
    submitProposalAction: (i: unknown) => run(proposalInput, i, "proposal", "", deps.db.submitProposal, (v, r) => ({ id: idOf(r), paths: [`/projects/${v.projectId}`] })),
    decideProposal: (i: unknown) => run(decideInput, i, "message", "write:", (v) => deps.db.setProposalStatus(v.id, v.status), (v) => ({ paths: [`/projects/${v.projectId}`] })),
    changeProjectStatus: (i: unknown) => run(statusInput, i, "message", "write:", deps.db.setProjectStatus, (v) => ({ paths: [`/projects/${v.id}`, "/projects"] })),
    withdrawProposalAction: (i: unknown) => run(withdrawInput, i, "message", "write:", (v) => deps.db.withdrawProposal(v.orgId, v.id), (v) => ({ paths: [`/projects/${v.projectId}`] })),
    markRead: (i: unknown) => run(readInput, i, "message", "write:", (v) => deps.db.markNotificationRead(v.id), () => ({ paths: ["/notifications"] })),
    startThread: (i: unknown) => run(startThreadInput, i, "conversation", "", deps.db.startConversation, (_v, r) => ({ id: idOf(r), paths: ["/messages"] })),
    postMessage: (i: unknown) => run(messageInput, i, "message", "", deps.db.sendMessage, (v) => ({ paths: [`/messages/${v.conversationId}`] })),
    reportContent: (i: unknown) => run(reportInput, i, "report", "", deps.db.report, () => ({ paths: [] })),
  };
}
