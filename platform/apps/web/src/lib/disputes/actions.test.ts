import { describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotAllowedError } from "../marketplace/errors";
import { createDisputeActions } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const input = (outcome: string) => ({ disputeId: id, outcome, note: "Refund the client in full" });

function setup(aal2 = true) {
  const db = { resolveDispute: vi.fn(async (_i: { disputeId: string; outcome: string; note: string }) => undefined) };
  const refunds = { issueForDispute: vi.fn(async (_id: string) => ({ issued: 2, failed: 0 })) };
  const revalidate = vi.fn();
  return { db, refunds, revalidate, actions: createDisputeActions({ db, refunds, revalidate, hasSecondFactor: async () => aal2 }) };
}

describe("rule", () => {
  it("records the ruling first, then sends the refunds for a refund ruling", async () => {
    const { actions, db, refunds, revalidate } = setup();
    expect(await actions.rule(input("refund_cancel"))).toEqual({ ok: true, issued: 2, failed: 0 });
    expect(db.resolveDispute).toHaveBeenCalledWith({ disputeId: id, outcome: "refund_cancel", note: "Refund the client in full" });
    expect(db.resolveDispute.mock.invocationCallOrder[0]).toBeLessThan(refunds.issueForDispute.mock.invocationCallOrder[0]);
    expect(revalidate).toHaveBeenCalledWith("/admin/disputes");
    expect(revalidate).toHaveBeenCalledWith(`/admin/disputes/${id}`);
  });
  it.each(["resume", "complete", "cancel"])("never touches money for %s", async (outcome) => {
    const { actions, refunds } = setup();
    expect(await actions.rule(input(outcome))).toEqual({ ok: true, issued: 0, failed: 0 });
    expect(refunds.issueForDispute).not.toHaveBeenCalled();
  });
  it("keeps the ruling and asks for a retry when Stripe is unreachable", async () => {
    const { actions, refunds } = setup();
    refunds.issueForDispute.mockRejectedValueOnce(new Error("payments not configured"));
    expect(await actions.rule(input("refund_cancel"))).toEqual({ ok: true, issued: 0, failed: 0, retryNeeded: true });
  });
  it("reports refunds that failed so the admin sees a Retry", async () => {
    const { actions, refunds } = setup();
    refunds.issueForDispute.mockResolvedValueOnce({ issued: 1, failed: 1 });
    expect(await actions.rule(input("refund_cancel"))).toEqual({ ok: true, issued: 1, failed: 1 });
  });
  it("does not send refunds when the database refuses the ruling", async () => {
    const { actions, db, refunds } = setup();
    db.resolveDispute.mockRejectedValueOnce(new NotAllowedError());
    expect(await actions.rule(input("refund_cancel"))).toEqual({ ok: false, code: "forbidden" });
    expect(refunds.issueForDispute).not.toHaveBeenCalled();
  });
  it("maps an invalid ruling to a calm code", async () => {
    const { actions, db } = setup();
    db.resolveDispute.mockRejectedValueOnce(new InvalidInputError());
    expect(await actions.rule(input("cancel"))).toEqual({ ok: false, code: "invalid" });
  });
  it("rejects bad input before touching the database", async () => {
    const { actions, db } = setup();
    expect(await actions.rule({ disputeId: id, outcome: "refund", note: "long enough note" })).toEqual({ ok: false, code: "invalid" });
    expect(db.resolveDispute).not.toHaveBeenCalled();
  });
  it("turns an unexpected failure into a generic error", async () => {
    const { actions, db } = setup();
    db.resolveDispute.mockRejectedValueOnce(new Error("boom with details"));
    expect(await actions.rule(input("cancel"))).toEqual({ ok: false, code: "error" });
  });
});

describe("retry", () => {
  it("repeats the pending refunds", async () => {
    const { actions, refunds } = setup();
    expect(await actions.retry({ disputeId: id })).toEqual({ ok: true, issued: 2, failed: 0 });
    expect(refunds.issueForDispute).toHaveBeenCalledWith(id);
  });
  it("reports an error when Stripe cannot be reached", async () => {
    const { actions, refunds } = setup();
    refunds.issueForDispute.mockRejectedValueOnce(new Error("down"));
    expect(await actions.retry({ disputeId: id })).toEqual({ ok: false, code: "error" });
  });
  it("rejects a bad id", async () => {
    expect(await setup().actions.retry({ disputeId: "x" })).toEqual({ ok: false, code: "invalid" });
  });
});

describe("second factor", () => {
  it("refuses Retry without a second factor before calling Stripe", async () => {
    const { actions, refunds } = setup(false);
    expect(await actions.retry({ disputeId: id })).toEqual({ ok: false, code: "forbidden" });
    expect(refunds.issueForDispute).not.toHaveBeenCalled();
  });
  it("refuses a ruling without a second factor before the database is asked", async () => {
    const { actions, db } = setup(false);
    expect(await actions.rule(input("refund_cancel"))).toEqual({ ok: false, code: "forbidden" });
    expect(db.resolveDispute).not.toHaveBeenCalled();
  });
});
