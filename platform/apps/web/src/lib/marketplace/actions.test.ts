import { describe, expect, it, vi } from "vitest";
import { createActions } from "./actions";
import { LimitError, NotAllowedError } from "./errors";

const U = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;

function make(opts: { user?: boolean; allow?: boolean } = {}) {
  const db = {
    upsertProfile: vi.fn(async () => U(50)), upsertService: vi.fn(async () => U(51)), upsertProject: vi.fn(async () => U(52)),
    submitProposal: vi.fn(async () => U(53)), setProposalStatus: vi.fn(async () => undefined),
    setProjectStatus: vi.fn(async () => undefined), withdrawProposal: vi.fn(async () => undefined), markNotificationRead: vi.fn(async () => undefined),
    startConversation: vi.fn(async () => U(54)), sendMessage: vi.fn(async () => U(55)), report: vi.fn(async () => U(56)),
  };
  const throttle = vi.fn(async () => opts.allow ?? true);
  const revalidate = vi.fn();
  const actions = createActions({ db, auth: async () => (opts.user === false ? null : { userId: U(9) }), throttle, revalidate });
  return { db, throttle, revalidate, actions };
}
const proposal = { orgId: U(1), projectId: U(2), coverLetter: "hi", price: 1000, currency: "USD", deliveryDays: 7 };

describe("marketplace actions", () => {
  it("returns invalid on bad input before touching the database or limiter", async () => {
    const { actions, db, throttle } = make();
    expect(await actions.submitProposalAction({ ...proposal, price: -5 })).toEqual({ ok: false, code: "invalid" });
    expect(db.submitProposal).not.toHaveBeenCalled();
    expect(throttle).not.toHaveBeenCalled();
  });
  it("returns forbidden when signed out", async () => {
    const { actions, db } = make({ user: false });
    expect(await actions.submitProposalAction(proposal)).toEqual({ ok: false, code: "forbidden" });
    expect(db.submitProposal).not.toHaveBeenCalled();
  });
  it("returns rate when the limiter blocks", async () => {
    const { actions, db } = make({ allow: false });
    expect(await actions.postMessage({ conversationId: U(4), orgId: U(1), body: "x" })).toEqual({ ok: false, code: "rate" });
    expect(db.sendMessage).not.toHaveBeenCalled();
  });
  it("passes the explicit orgId from the input and revalidates", async () => {
    const { actions, db, revalidate } = make();
    const r = await actions.submitProposalAction(proposal);
    expect(r).toEqual({ ok: true, id: U(53) });
    expect(db.submitProposal).toHaveBeenCalledWith(expect.objectContaining({ orgId: U(1), projectId: U(2) }));
    expect(revalidate).toHaveBeenCalledWith(`/projects/${U(2)}`);
  });
  it("throttles per user with the matching rule", async () => {
    const { actions, throttle } = make();
    await actions.reportContent({ kind: "profile", id: U(5), reason: "spam" });
    expect(throttle).toHaveBeenCalledWith("report", U(9));
  });
  it("maps typed database errors to codes, never raw messages", async () => {
    const { actions, db } = make();
    db.submitProposal.mockRejectedValueOnce(new LimitError());
    expect(await actions.submitProposalAction(proposal)).toEqual({ ok: false, code: "limit" });
    db.submitProposal.mockRejectedValueOnce(new NotAllowedError());
    expect(await actions.submitProposalAction(proposal)).toEqual({ ok: false, code: "forbidden" });
    db.submitProposal.mockRejectedValueOnce(new Error("pg: password=hunter2"));
    expect(await actions.submitProposalAction(proposal)).toEqual({ ok: false, code: "error" });
  });
  it("startThread requires an org and a first message", async () => {
    const { actions, db } = make();
    expect(await actions.startThread({ fromOrgId: U(1), kind: "service", refId: U(3), firstMessage: "" })).toEqual({ ok: false, code: "invalid" });
    expect(await actions.startThread({ fromOrgId: U(1), kind: "service", refId: U(3), firstMessage: "hello" })).toEqual({ ok: true, id: U(54) });
    expect(db.startConversation).toHaveBeenCalledTimes(1);
  });
  it("decideProposal accepts only shortlisted or declined", async () => {
    const { actions } = make();
    expect(await actions.decideProposal({ id: U(6), projectId: U(2), status: "hired" })).toEqual({ ok: false, code: "invalid" });
    expect((await actions.decideProposal({ id: U(6), projectId: U(2), status: "shortlisted" })).ok).toBe(true);
  });
  it("changeProjectStatus passes the explicit org and only known statuses", async () => {
    const { actions, db, revalidate } = make();
    expect(await actions.changeProjectStatus({ orgId: U(1), id: U(2), status: "deleted" })).toEqual({ ok: false, code: "invalid" });
    expect((await actions.changeProjectStatus({ orgId: U(1), id: U(2), status: "open" })).ok).toBe(true);
    expect(db.setProjectStatus).toHaveBeenCalledWith({ orgId: U(1), id: U(2), status: "open" });
    expect(revalidate).toHaveBeenCalledWith(`/projects/${U(2)}`);
  });
  it("withdrawProposalAction and markRead validate ids and call their RPCs", async () => {
    const { actions, db } = make();
    expect(await actions.withdrawProposalAction({ orgId: "nope", id: U(6), projectId: U(2) })).toEqual({ ok: false, code: "invalid" });
    expect((await actions.withdrawProposalAction({ orgId: U(1), id: U(6), projectId: U(2) })).ok).toBe(true);
    expect(db.withdrawProposal).toHaveBeenCalledWith(U(1), U(6));
    expect((await actions.markRead({ id: U(7) })).ok).toBe(true);
    expect(db.markNotificationRead).toHaveBeenCalledWith(U(7));
  });
});
