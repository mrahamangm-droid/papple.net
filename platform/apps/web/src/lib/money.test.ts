import { describe, expect, it } from "vitest";
import { applyBps, splitCommission } from "./money";

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
