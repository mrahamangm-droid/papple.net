export const FEATURE_LABEL: Record<string, string> = {
  proposal_draft: "Proposal drafts",
  polish_profile: "Profile polish",
  polish_service: "Service polish",
  improve_brief: "Project brief improvements",
};

export interface UsageRow { kind: "feature" | "org"; label: string; calls: number; errors: number; tokens_in: number; tokens_out: number }

/** Only 7, 30 or 90 days; anything else is 30. Repeated query parameters use the first value. */
export function parseWindow(raw: string | string[] | undefined): 7 | 30 | 90 {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "7" ? 7 : v === "90" ? 90 : 30;
}

const isRow = (r: unknown): r is UsageRow => {
  const x = r as Record<string, unknown> | null;
  return !!x && (x.kind === "feature" || x.kind === "org") && typeof x.label === "string" && typeof x.calls === "number";
};

export function splitSummary(raw: unknown) {
  const rows = (Array.isArray(raw) ? raw : []).filter(isRow);
  const features = rows.filter((r) => r.kind === "feature").map((r) => ({ ...r, label: FEATURE_LABEL[r.label] ?? r.label }));
  const orgs = rows.filter((r) => r.kind === "org");
  const total = features.reduce((t, r) => ({ calls: t.calls + r.calls, errors: t.errors + r.errors, tokensIn: t.tokensIn + r.tokens_in, tokensOut: t.tokensOut + r.tokens_out }), { calls: 0, errors: 0, tokensIn: 0, tokensOut: 0 });
  return { features, orgs, total };
}
