import { z } from "zod";

export type InvoiceFailure = "forbidden" | "invalid" | "notready" | "rate" | "error";
export type InvoiceResult = { ok: true; id: string } | { ok: false; code: InvoiceFailure };
export type SaveResult = { ok: true } | { ok: false; code: InvoiceFailure };

export interface InvoiceDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may issue. */
  rpc: (fn: "issue_invoice" | "issue_credit_note" | "save_billing_profile", args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  revalidate: (path: string) => void;
}

const id = z.string().uuid();
const issueInput = z.object({ orgId: id, contractId: id, milestoneId: id });
const creditInput = z.object({ orgId: id, contractId: id, invoiceId: id });
const profileInput = z.object({
  orgId: id,
  legalName: z.string().trim().min(2).max(160),
  address: z.string().trim().min(5).max(500),
  country: z.string().trim().length(2).transform((c) => c.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/)),
  taxNumber: z.string().trim().max(40).optional(),
  taxPercent: z.number().min(0).max(100).refine(Number.isFinite),
});

const failure = (code?: string): InvoiceFailure =>
  code === "42501" ? "forbidden" : code === "55000" ? "notready" : code === "22023" ? "invalid" : "error";

export function createInvoiceService(deps: InvoiceDeps) {
  /** Shared gate: signed in, then throttled. A broken limiter fails closed. */
  async function gate(): Promise<{ ok: false; code: InvoiceFailure } | { ok: true }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true };
  }

  async function issueWith(raw: unknown, schema: z.ZodType<{ orgId: string; contractId: string }>, fn: "issue_invoice" | "issue_credit_note", args: (v: never) => Record<string, unknown>): Promise<InvoiceResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const g = await gate();
    if (!g.ok) return g;
    try {
      const { data, error } = await deps.rpc(fn, args(parsed.data as never));
      if (error || typeof data !== "string") return { ok: false, code: failure(error?.code) };
      deps.revalidate(`/contracts/${parsed.data.contractId}`);
      return { ok: true, id: data };
    } catch {
      return { ok: false, code: "error" };
    }
  }

  return {
    issue: (raw: unknown) => issueWith(raw, issueInput, "issue_invoice", (v: z.infer<typeof issueInput>) => ({ p_org: v.orgId, p_milestone: v.milestoneId })),
    creditNote: (raw: unknown) => issueWith(raw, creditInput, "issue_credit_note", (v: z.infer<typeof creditInput>) => ({ p_org: v.orgId, p_invoice: v.invoiceId })),

    async saveProfile(raw: unknown): Promise<SaveResult> {
      const parsed = profileInput.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const g = await gate();
      if (!g.ok) return g;
      const v = parsed.data;
      try {
        const { error } = await deps.rpc("save_billing_profile", {
          p_org: v.orgId, p_legal_name: v.legalName, p_address: v.address, p_country: v.country,
          p_tax_number: v.taxNumber ? v.taxNumber : null, p_tax_bps: Math.round(v.taxPercent * 100),
        });
        if (error) return { ok: false, code: failure(error.code) };
        deps.revalidate("/settings/invoicing");
        return { ok: true };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}
