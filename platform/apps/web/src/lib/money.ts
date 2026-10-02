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

/**
 * Amounts for one milestone payment (destination charge). The client pays amount + client fee; Papple keeps the
 * application fee (both fees, but never less than the configured floor and never more than the client pays);
 * the professional's account receives the rest. net + application fee always equals what the client paid.
 */
export function computeMilestoneCharge(amountMinor: number, professionalBps: number, clientBps: number, minFeeMinor: number) {
  assertInt(minFeeMinor, "minFeeMinor");
  const { clientFeeMinor, professionalFeeMinor } = splitCommission(amountMinor, professionalBps, clientBps);
  const clientTotalMinor = amountMinor + clientFeeMinor;
  const applicationFeeMinor = Math.min(Math.max(clientFeeMinor + professionalFeeMinor, minFeeMinor), clientTotalMinor);
  return {
    amountMinor, clientFeeMinor, professionalFeeMinor, clientTotalMinor, applicationFeeMinor,
    professionalNetMinor: clientTotalMinor - applicationFeeMinor,
  };
}
