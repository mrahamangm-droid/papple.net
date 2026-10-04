import { describe, expect, it, vi } from "vitest";
import { createRefundService } from "./refunds";

const row = (n: number) => ({ paymentId: `p${n}`, paymentIntentId: `pi_${n}`, amount: 1000 * n, currency: "USD", idempotencyKey: `refund:p${n}` });

function setup(pending: ReturnType<typeof row>[]) {
  const list = vi.fn(async (_d: string) => pending);
  const recordFailed = vi.fn(async (_p: string, _r: string) => undefined);
  const refund = vi.fn(async (_i: { paymentId: string; paymentIntentId: string; amountMinor: number; currency: string; idempotencyKey: string }) => ({ refundId: "re_x" }));
  const service = createRefundService({ db: { listPendingRefunds: list, recordRefundFailed: recordFailed }, provider: { refundPayment: refund } });
  return { service, list, recordFailed, refund };
}

describe("refund service", () => {
  it("sends every pending refund with its idempotency key and the amount stored in the database", async () => {
    const { service, refund } = setup([row(1), row(2)]);
    expect(await service.issueForDispute("d1")).toEqual({ issued: 2, failed: 0 });
    expect(refund).toHaveBeenNthCalledWith(1, { paymentId: "p1", paymentIntentId: "pi_1", amountMinor: 1000, currency: "USD", idempotencyKey: "refund:p1" });
    expect(refund).toHaveBeenNthCalledWith(2, { paymentId: "p2", paymentIntentId: "pi_2", amountMinor: 2000, currency: "USD", idempotencyKey: "refund:p2" });
  });
  it("keeps going when one refund fails and records why", async () => {
    const { service, refund, recordFailed } = setup([row(1), row(2)]);
    refund.mockRejectedValueOnce(new Error("insufficient balance"));
    expect(await service.issueForDispute("d1")).toEqual({ issued: 1, failed: 1 });
    expect(recordFailed).toHaveBeenCalledWith("p1", "insufficient balance");
    expect(refund).toHaveBeenCalledTimes(2);
  });
  it("a retry repeats only what the database still lists as pending", async () => {
    const { service, list, refund } = setup([row(1), row(2)]);
    refund.mockRejectedValueOnce(new Error("network"));
    await service.issueForDispute("d1");
    list.mockResolvedValueOnce([row(1)]); // the webhook already finalized p2
    refund.mockClear();
    expect(await service.issueForDispute("d1")).toEqual({ issued: 1, failed: 0 });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "p1", idempotencyKey: "refund:p1" }));
  });
  it("does nothing when no refund is pending", async () => {
    const { service, refund } = setup([]);
    expect(await service.issueForDispute("d1")).toEqual({ issued: 0, failed: 0 });
    expect(refund).not.toHaveBeenCalled();
  });
  it("still counts a failure when recording the reason fails too", async () => {
    const { service, refund, recordFailed } = setup([row(1)]);
    refund.mockRejectedValueOnce(new Error("stripe down"));
    recordFailed.mockRejectedValueOnce(new Error("db down"));
    expect(await service.issueForDispute("d1")).toEqual({ issued: 0, failed: 1 });
  });
});
