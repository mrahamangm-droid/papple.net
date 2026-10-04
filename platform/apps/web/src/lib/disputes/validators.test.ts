import { describe, expect, it } from "vitest";
import { retryRefundsInput, ruleDisputeInput } from "./validators";

const id = "11111111-1111-4111-8111-111111111111";
const ok = { disputeId: id, outcome: "resume", note: "Both sides agreed to go on" };

describe("ruleDisputeInput", () => {
  it("accepts every outcome", () => {
    for (const outcome of ["resume", "complete", "cancel", "refund_cancel"]) expect(ruleDisputeInput.safeParse({ ...ok, outcome }).success).toBe(true);
  });
  it("rejects an unknown outcome and a bad id", () => {
    expect(ruleDisputeInput.safeParse({ ...ok, outcome: "refund" }).success).toBe(false);
    expect(ruleDisputeInput.safeParse({ ...ok, disputeId: "nope" }).success).toBe(false);
  });
  it("needs a note of 10 to 1000 characters after trimming", () => {
    expect(ruleDisputeInput.safeParse({ ...ok, note: "123456789" }).success).toBe(false);
    expect(ruleDisputeInput.safeParse({ ...ok, note: "          x          " }).success).toBe(false);
    expect(ruleDisputeInput.safeParse({ ...ok, note: "1234567890" }).success).toBe(true);
    expect(ruleDisputeInput.safeParse({ ...ok, note: "x".repeat(1000) }).success).toBe(true);
    expect(ruleDisputeInput.safeParse({ ...ok, note: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("retryRefundsInput", () => {
  it("needs only a dispute id", () => {
    expect(retryRefundsInput.safeParse({ disputeId: id }).success).toBe(true);
    expect(retryRefundsInput.safeParse({}).success).toBe(false);
  });
});
