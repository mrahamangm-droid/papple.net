function assertInt(n: number, name: string) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

/** Apply a rate in basis points (1 bp = 0.01%) to an amount in minor units. Rounds half up. */
export function applyBps(amountMinor: number, bps: number): number {
  assertInt(amountMinor, "amountMinor");
  assertInt(bps, "bps");
  if (bps > 10_000) throw new RangeError("bps must be <= 10000");
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}

export function splitCommission(amountMinor: number, professionalBps: number, clientBps: number) {
  return {
    clientFeeMinor: applyBps(amountMinor, clientBps),
    professionalFeeMinor: applyBps(amountMinor, professionalBps),
  };
}
