import { describe, expect, it, vi } from "vitest";
import { createAiService, type AiDeps } from "./service";
import { AiUnavailableError } from "./client";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function setup(over: Partial<AiDeps> = {}, client: { text?: string; fail?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const complete = vi.fn(async () => {
    if (client.fail) throw new AiUnavailableError();
    return { text: client.text ?? "A good draft.", tokensIn: 100, tokensOut: 50 };
  });
  const deps: AiDeps = {
    getUserId: async () => "user-1",
    throttle: async () => true,
    rpc: async (fn, args) => { calls.push({ fn, args }); return { data: fn === "ai_reserve" ? "res-1" : null, error: null }; },
    client: { complete },
    loadProposalContext: async () => ({ project: { title: "Site", description: "Build a site", budget: "USD 500" }, profile: { headline: "Dev", summary: "I code", skills: ["React"] } }),
    ...over,
  };
  return { svc: createAiService(deps), calls, complete };
}
const finish = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.find((c) => c.fn === "ai_finish");

describe("ai service", () => {
  it("drafts a proposal: reserve, call the model, finish ok, return text", async () => {
    const { svc, calls, complete } = setup();
    expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: true, text: "A good draft." });
    expect(calls.map((c) => c.fn)).toEqual(["ai_reserve", "ai_finish"]);
    expect(calls[0]!.args).toEqual({ p_org: ORG, p_feature: "proposal_draft" });
    expect(finish(calls)!.args).toEqual({ p_id: "res-1", p_in: 100, p_out: 50, p_outcome: "ok" });
    expect(complete).toHaveBeenCalledOnce();
  });
  it("never stores prompt or answer text in any database call", async () => {
    const { svc, calls } = setup({}, { text: "SECRET-ANSWER" });
    await svc.polish({ orgId: ORG, kind: "profile", text: "SECRET-INPUT text here" });
    expect(JSON.stringify(calls)).not.toMatch(/SECRET/);
  });
  it("requires a signed-in user", async () => {
    const { svc, complete } = setup({ getUserId: async () => null });
    expect(await svc.improveBrief({ orgId: ORG, title: "A title", description: "A description" })).toEqual({ ok: false, code: "forbidden" });
    expect(complete).not.toHaveBeenCalled();
  });
  it("rejects invalid input before touching the database or the model", async () => {
    const { svc, calls, complete } = setup();
    expect(await svc.polish({ orgId: "nope", kind: "profile", text: "long enough text here" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.polish({ orgId: ORG, kind: "profile", text: "short" })).toEqual({ ok: false, code: "invalid" });
    expect(await svc.polish({ orgId: ORG, kind: "other" as never, text: "long enough text here" })).toEqual({ ok: false, code: "invalid" });
    expect(calls).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
  it("is rate limited per user before any reservation", async () => {
    const { svc, calls } = setup({ throttle: async () => false });
    expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: false, code: "rate" });
    expect(calls).toEqual([]);
  });
  it("a throwing rate limiter becomes a calm error, not a crash", async () => {
    const { svc, calls } = setup({ throttle: async () => { throw new Error("redis down"); } });
    expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: false, code: "error" });
    expect(calls).toEqual([]);
  });
  it("reports unavailable without reserving when no key is configured", async () => {
    const { svc, calls } = setup({ client: null });
    expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: false, code: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("maps database refusals and never calls the model after them", async () => {
    for (const [code, expected] of [["42501", "forbidden"], ["54000", "limit"], ["22023", "invalid"], ["XX000", "error"]] as const) {
      const { svc, complete } = setup({ rpc: async () => ({ data: null, error: { code } }) });
      expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: false, code: expected });
      expect(complete).not.toHaveBeenCalled();
    }
  });
  it("a missing project is invalid and does not reserve", async () => {
    const { svc, calls } = setup({ loadProposalContext: async () => null });
    expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: false, code: "invalid" });
    expect(calls).toEqual([]);
  });
  it("a failed model call is finished as error and reported as unavailable", async () => {
    const { svc, calls } = setup({}, { fail: true });
    expect(await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).toEqual({ ok: false, code: "unavailable" });
    expect(finish(calls)!.args).toMatchObject({ p_outcome: "error", p_in: 0, p_out: 0 });
  });
  it("empty model output is finished as error and not returned", async () => {
    const { svc, calls } = setup({}, { text: "   " });
    expect(await svc.improveBrief({ orgId: ORG, title: "A title", description: "A description" })).toEqual({ ok: false, code: "error" });
    expect(finish(calls)!.args).toMatchObject({ p_outcome: "error" });
  });
  it("sanitises output: strips tags and caps to the field limit", async () => {
    const { svc } = setup({}, { text: "<b>Hi</b> " + "x".repeat(6000) });
    const r = await svc.draftProposal({ orgId: ORG, projectId: PROJECT });
    expect(r.ok && r.text.length).toBe(5000);
    expect(r.ok && r.text.startsWith("Hi xxx")).toBe(true);
  });
  it("still returns the answer when finishing the reservation fails", async () => {
    let n = 0;
    const { svc } = setup({ rpc: async (_fn) => (++n === 1 ? { data: "res-1", error: null } : { data: null, error: { code: "XX000" } }) });
    expect((await svc.draftProposal({ orgId: ORG, projectId: PROJECT })).ok).toBe(true);
  });
});
