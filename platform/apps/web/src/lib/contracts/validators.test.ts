import { describe, expect, it } from "vitest";
import { cancelInput, contractRef, disputeInput, hireInput, milestoneRef, requestChangesInput, reviewInput, setMilestonesInput } from "./validators";

const U = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;

describe("contract validators", () => {
  it("accepts a valid hire request and rejects non-uuids", () => {
    expect(hireInput.safeParse({ orgId: U(1), proposalId: U(2), projectId: U(3) }).success).toBe(true);
    expect(hireInput.safeParse({ orgId: "x", proposalId: U(2), projectId: U(3) }).success).toBe(false);
  });
  it("milestones need whole-number amounts of at least one minor unit", () => {
    const base = { orgId: U(1), contractId: U(2) };
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "A", amount: 100 }] }).success).toBe(true);
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "A", amount: 10.5 }] }).success).toBe(false);
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "A", amount: 0 }] }).success).toBe(false);
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "A", amount: 2147483648 }] }).success).toBe(false);
    expect(setMilestonesInput.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "   ", amount: 5 }] }).success).toBe(false);
  });
  it("milestone due dates must be ISO dates", () => {
    const base = { orgId: U(1), contractId: U(2) };
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "A", amount: 5, dueDate: "2026-12-31" }] }).success).toBe(true);
    expect(setMilestonesInput.safeParse({ ...base, items: [{ title: "A", amount: 5, dueDate: "31/12/2026" }] }).success).toBe(false);
  });
  it("trims titles and defaults descriptions", () => {
    const r = setMilestonesInput.parse({ orgId: U(1), contractId: U(2), items: [{ title: "  Design  ", amount: 5 }] });
    expect(r.items[0]).toMatchObject({ title: "Design", description: "" });
  });
  it("change requests need a note", () => {
    const base = { orgId: U(1), contractId: U(2), milestoneId: U(3) };
    expect(requestChangesInput.safeParse({ ...base, note: "  " }).success).toBe(false);
    expect(requestChangesInput.safeParse({ ...base, note: "Fix it" }).success).toBe(true);
  });
  it("disputes need a real reason", () => {
    expect(disputeInput.safeParse({ orgId: U(1), contractId: U(2), reason: "bad" }).success).toBe(false);
    expect(disputeInput.safeParse({ orgId: U(1), contractId: U(2), reason: "The work was never delivered" }).success).toBe(true);
  });
  it("reviews are rated 1 to 5", () => {
    const base = { orgId: U(1), contractId: U(2) };
    expect(reviewInput.safeParse({ ...base, rating: 0 }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, rating: 6 }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, rating: 4.5 }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, rating: 5 }).success).toBe(true);
  });
  it("cancel reason is optional and capped", () => {
    expect(cancelInput.safeParse({ orgId: U(1), contractId: U(2) }).success).toBe(true);
    expect(cancelInput.safeParse({ orgId: U(1), contractId: U(2), reason: "x".repeat(1001) }).success).toBe(false);
  });
  it("refs require uuids", () => {
    expect(contractRef.safeParse({ orgId: U(1), contractId: "nope" }).success).toBe(false);
    expect(milestoneRef.safeParse({ orgId: U(1), contractId: U(2), milestoneId: U(3) }).success).toBe(true);
  });
});
