import { z } from "zod";
import type { AiClient } from "./client";
import { briefPrompt, polishPrompt, proposalPrompt, sanitizeOutput, type Prompt } from "./prompts";

export type AiResult = { ok: true; text: string } | { ok: false; code: "forbidden" | "invalid" | "limit" | "rate" | "unavailable" | "error" };

export interface ProposalContext {
  project: { title: string; description: string; budget?: string };
  profile: { headline: string; summary: string; skills: string[] };
}

export interface AiDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  rpc: (fn: "ai_reserve" | "ai_finish", args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  /** Null when no provider key is configured. */
  client: AiClient | null;
  /** Loaded through the caller's own session, so row-level security decides what the person may see. */
  loadProposalContext: (orgId: string, projectId: string) => Promise<ProposalContext | null>;
}

const id = z.string().uuid();
const proposalInput = z.object({ orgId: id, projectId: id });
const polishInput = z.object({ orgId: id, kind: z.enum(["profile", "service"]), text: z.string().trim().min(10).max(5000), title: z.string().trim().max(150).optional() });
const briefInput = z.object({ orgId: id, title: z.string().trim().min(5).max(150), description: z.string().trim().min(10).max(10000) });

type Feature = "proposal_draft" | "polish_profile" | "polish_service" | "improve_brief";

export function createAiService(deps: AiDeps) {
  const refusal = (code?: string): AiResult =>
    ({ ok: false, code: code === "42501" ? "forbidden" : code === "54000" ? "limit" : code === "22023" ? "invalid" : "error" });

  async function run(raw: unknown, schema: z.ZodType<{ orgId: string }>, feature: Feature, maxOut: number, build: (v: never) => Promise<Prompt | null>): Promise<AiResult> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "invalid" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    if (!deps.client) return { ok: false, code: "unavailable" };
    let prompt: Prompt | null;
    try { prompt = await build(parsed.data as never); } catch { return { ok: false, code: "error" }; }
    if (!prompt) return { ok: false, code: "invalid" };

    const reserved = await deps.rpc("ai_reserve", { p_org: parsed.data.orgId, p_feature: feature });
    if (reserved.error || typeof reserved.data !== "string") return refusal(reserved.error?.code);
    const reservation = reserved.data;
    const finish = (tin: number, tout: number, outcome: "ok" | "error") =>
      deps.rpc("ai_finish", { p_id: reservation, p_in: tin, p_out: tout, p_outcome: outcome }).catch(() => undefined);

    let completion;
    try {
      completion = await deps.client.complete(prompt);
    } catch {
      await finish(0, 0, "error");
      return { ok: false, code: "unavailable" };
    }
    const text = sanitizeOutput(completion.text, maxOut);
    await finish(completion.tokensIn, completion.tokensOut, text ? "ok" : "error");
    return text ? { ok: true, text } : { ok: false, code: "error" };
  }

  return {
    draftProposal: (raw: unknown) => run(raw, proposalInput, "proposal_draft", 5000, async (v: z.infer<typeof proposalInput>) => {
      const ctx = await deps.loadProposalContext(v.orgId, v.projectId);
      return ctx ? proposalPrompt(ctx) : null;
    }),
    polish: (raw: unknown) => {
      const kind = (raw as { kind?: unknown } | null)?.kind;
      return run(raw, polishInput, kind === "service" ? "polish_service" : "polish_profile", 5000, async (v: z.infer<typeof polishInput>) => polishPrompt(v));
    },
    improveBrief: (raw: unknown) => run(raw, briefInput, "improve_brief", 10000, async (v: z.infer<typeof briefInput>) => briefPrompt(v)),
  };
}
