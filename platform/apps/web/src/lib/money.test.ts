import { describe, expect, it } from "vitest";
import { applyBps, computeMilestoneCharge, splitCommission } from "./money";

describe("applyBps", () => {
  it("applies basis points to integer minor units", () => {
    expect(applyBps(10000, 500)).toBe(500);
  });
  it("rounds half up", () => {
    expect(applyBps(999, 500)).toBe(50); // 49.95 -> 50
    expect(applyBps(1, 5000)).toBe(1); // 0.5 -> 1
  });
  it("handles zero amount and zero rate", () => {
    expect(applyBps(0, 500)).toBe(0);
    expect(applyBps(10000, 0)).toBe(0);
  });
  it("throws on non-integer or negative inputs", () => {
    expect(() => applyBps(10.5, 500)).toThrow();
    expect(() => applyBps(-1, 500)).toThrow();
    expect(() => applyBps(100, -5)).toThrow();
    expect(() => applyBps(100, 10001)).toThrow();
  });
});

describe("splitCommission", () => {
  it("returns client fee and professional fee from launch rates", () => {
    expect(splitCommission(10000, 500, 200)).toEqual({ clientFeeMinor: 200, professionalFeeMinor: 500 });
  });
});

describe("computeMilestoneCharge", () => {
  it("computes launch-rate amounts", () => {
    expect(computeMilestoneCharge(100000, 500, 200, 0)).toEqual({
      amountMinor: 100000, clientFeeMinor: 2000, professionalFeeMinor: 5000,
      clientTotalMinor: 102000, applicationFeeMinor: 7000, professionalNetMinor: 95000,
    });
  });
  it("always adds up: professional net = client total - application fee, and net + application fee = client total", () => {
    for (let i = 0; i < 1000; i++) {
      const amount = Math.floor(Math.random() * 5_000_000) + 1;
      const c = computeMilestoneCharge(amount, 500, 200, 50);
      expect(c.professionalNetMinor + c.applicationFeeMinor).toBe(c.clientTotalMinor);
      expect(c.professionalNetMinor).toBeGreaterThanOrEqual(0);
      expect(c.clientTotalMinor).toBe(amount + c.clientFeeMinor);
    }
  });
  it("applies the minimum application fee", () => {
    const c = computeMilestoneCharge(100, 500, 200, 50);
    expect(c.applicationFeeMinor).toBe(50);
    expect(c.professionalNetMinor).toBe(c.clientTotalMinor - 50);
  });
  it("never lets the floor exceed what the client pays", () => {
    const c = computeMilestoneCharge(10, 500, 200, 1000);
    expect(c.applicationFeeMinor).toBe(c.clientTotalMinor);
    expect(c.professionalNetMinor).toBe(0);
  });
  it("works for zero-decimal currencies", () => {
    const c = computeMilestoneCharge(1, 500, 200, 0);
    expect(c.clientTotalMinor).toBe(1);
    expect(c.professionalNetMinor).toBeGreaterThanOrEqual(0);
  });
  it("rejects bad input", () => {
    expect(() => computeMilestoneCharge(1.5, 500, 200, 0)).toThrow(RangeError);
    expect(() => computeMilestoneCharge(-1, 500, 200, 0)).toThrow(RangeError);
    expect(() => computeMilestoneCharge(100, 500, 200, -1)).toThrow(RangeError);
  });
});
