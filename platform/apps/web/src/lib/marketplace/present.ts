/** How many minor-unit digits a currency has (USD 2, JPY 0, KWD 3). Unknown codes assume 2. */
export function minorExponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** What a person types (major units) -> integer minor units. Rounds away float noise. */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** minorExponent(currency));
}

/** Integer minor units -> major units, for display inputs and structured data. */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** minorExponent(currency);
}

/** Minor units -> display string using the currency's real exponent. Unknown codes degrade to "<amount> CODE". */
export function formatMinor(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(fromMinor(minor, currency));
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function priceLabel(s: { pricing_model: string; price_min: number | null; currency: string }): string {
  if (s.pricing_model === "quote" || s.price_min == null) return "Custom quote";
  const base = `From ${formatMinor(s.price_min, s.currency)}`;
  return s.pricing_model === "hourly" ? `${base} / hour` : base;
}

export function rateLabel(p: { hourly_min: number | null; hourly_max: number | null; currency: string }): string | null {
  const { hourly_min: lo, hourly_max: hi, currency: c } = p;
  if (lo != null && hi != null) return `${formatMinor(lo, c)}–${formatMinor(hi, c)} / hour`;
  if (lo != null) return `From ${formatMinor(lo, c)} / hour`;
  if (hi != null) return `Up to ${formatMinor(hi, c)} / hour`;
  return null;
}

/** JSON for a <script type="application/ld+json">: `<` and line separators are escaped so content can never end the element. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .split("<").join("\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}
