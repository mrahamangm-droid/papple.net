import { z } from "zod";

export type EmailFailure = "forbidden" | "invalid" | "notready" | "suppressed" | "limit" | "rate" | "send_failed" | "unconfirmed" | "error";
export type EmailResult = { ok: true } | { ok: false; code: EmailFailure };

export interface OutgoingEmail { to: string; subject: string; text: string; replyTo: string | null; fromName: string; unsubscribeUrl: string; idempotencyKey: string }

/** Thrown by a sender only when the provider definitely did not accept the message. Any other error leaves the outcome unknown. */
export class EmailRefused extends Error {
  constructor(message = "email refused by provider") { super(message); this.name = "EmailRefused"; }
}

export interface CrmEmailDeps {
  getUserId: () => Promise<string | null>;
  throttle: (userId: string) => Promise<boolean>;
  /** Called as the signed-in user, so the database decides who may send. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  /** Resolves with the provider's message id (null if it accepted without one). Throws EmailRefused only for a definite refusal; any other error means the outcome is unknown. */
  send: (msg: OutgoingEmail) => Promise<string | null>;
  /** Records the outcome. Runs with the service role: users must not be able to rewrite their own message's status. */
  mark: (id: string, status: "sent" | "failed" | "unknown", provider: string | null) => Promise<void>;
  /** False unless the provider key, sender address, site URL and unsubscribe secret all exist. Checked before anything is reserved. */
  isConfigured: () => boolean;
  unsubscribeUrl: (orgId: string, email: string) => string;
  replyTo: (userId: string) => Promise<string | null>;
  revalidate: (path: string) => void;
}

const BASIS = ["existing_client", "opted_in", "requested_contact"] as const;
const id = z.string().uuid();
const sendInput = z.object({
  orgId: id, contactId: id,
  subject: z.string().trim().min(1).max(200).refine((s) => !/[\r\n]/.test(s)),
  body: z.string().trim().min(1).max(5000),
});
const basisInput = z.object({ orgId: id, contactId: id, basis: z.enum(BASIS).or(z.literal("")) });
const reservation = z.object({ id: z.string().uuid(), to: z.string().min(3), subject: z.string().min(1), body: z.string().min(1), basis: z.enum(BASIS), legal_name: z.string().min(1), address: z.string().min(1), country: z.string().min(2) });

const REASON: Record<(typeof BASIS)[number], (name: string) => string> = {
  existing_client: (n) => `you are a client of ${n}`,
  opted_in: (n) => `you asked to receive email from ${n}`,
  requested_contact: (n) => `you asked ${n} to contact you`,
};

/** The footer is built here from database values; the sender's text cannot replace or remove it. */
export function buildEmailText(o: { body: string; legalName: string; address: string; country: string; basis: string; unsubscribeUrl: string }): string {
  const why = (REASON[o.basis as (typeof BASIS)[number]] ?? (() => "you are in this sender's contact list"))(o.legalName);
  return `${o.body}\n\n--\nSent by ${o.legalName}, ${o.address}, ${o.country}.\nYou are receiving this because ${why}.\nUnsubscribe: ${o.unsubscribeUrl}\n`;
}

const failure = (code?: string): EmailFailure =>
  code === "42501" ? "forbidden" : code === "55000" ? "notready" : code === "23P01" ? "suppressed" : code === "54000" ? "limit" : code === "22023" ? "invalid" : "error";

export function createCrmEmailService(deps: CrmEmailDeps) {
  async function gate(): Promise<{ ok: true; userId: string } | { ok: false; code: EmailFailure }> {
    const userId = await deps.getUserId();
    if (!userId) return { ok: false, code: "forbidden" };
    try {
      if (!(await deps.throttle(userId))) return { ok: false, code: "rate" };
    } catch {
      return { ok: false, code: "error" };
    }
    return { ok: true, userId };
  }

  return {
    async sendEmail(raw: unknown): Promise<EmailResult> {
      const p = sendInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const g = await gate();
      if (!g.ok) return g;
      if (!deps.isConfigured()) return { ok: false, code: "notready" };
      const v = p.data;
      let r: z.infer<typeof reservation>;
      try {
        const { data, error } = await deps.rpc("crm_reserve_email", { p_org: v.orgId, p_contact: v.contactId, p_subject: v.subject, p_body: v.body });
        if (error) return { ok: false, code: failure(error.code) };
        const parsed = reservation.safeParse(data);
        if (!parsed.success) return { ok: false, code: "error" };
        r = parsed.data;
      } catch {
        return { ok: false, code: "error" };
      }
      const mark = async (status: "sent" | "failed" | "unknown", provider: string | null) => {
        try { await deps.mark(r.id, status, provider); } catch { /* the log is best effort once the outcome is known */ }
      };
      let providerId: string | null;
      try {
        const unsubscribeUrl = deps.unsubscribeUrl(v.orgId, r.to);
        providerId = await deps.send({
          to: r.to, subject: r.subject, fromName: r.legal_name, unsubscribeUrl, idempotencyKey: r.id, replyTo: await deps.replyTo(g.userId),
          text: buildEmailText({ body: r.body, legalName: r.legal_name, address: r.address, country: r.country, basis: r.basis, unsubscribeUrl }),
        });
      } catch (e) {
        if (e instanceof EmailRefused) {
          await mark("failed", null);
          return { ok: false, code: "send_failed" };
        }
        await mark("unknown", null);
        deps.revalidate(`/crm/${v.contactId}`);
        return { ok: false, code: "unconfirmed" };
      }
      await mark("sent", providerId);
      deps.revalidate(`/crm/${v.contactId}`);
      return { ok: true };
    },

    async setBasis(raw: unknown): Promise<EmailResult> {
      const p = basisInput.safeParse(raw);
      if (!p.success) return { ok: false, code: "invalid" };
      const g = await gate();
      if (!g.ok) return g;
      try {
        const { error } = await deps.rpc("crm_set_basis", { p_org: p.data.orgId, p_contact: p.data.contactId, p_basis: p.data.basis === "" ? null : p.data.basis });
        if (error) return { ok: false, code: failure(error.code) };
        deps.revalidate(`/crm/${p.data.contactId}`);
        return { ok: true };
      } catch {
        return { ok: false, code: "error" };
      }
    },
  };
}
