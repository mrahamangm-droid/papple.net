import { z } from "zod";

export type SettingUnit = "bps" | "minutes" | "days" | "minor" | "count" | "flag" | "json";
export interface SettingDef { label: string; unit: SettingUnit; schema: z.ZodType; risky: boolean; help: string }

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** The only settings the console edits. `payments.enabled` is deliberately absent: nothing enforces it yet, and an unenforced kill switch would give false assurance. The database keeps the stored JSON type; the ranges that make a value sane live here. */
export const SETTINGS: Record<string, SettingDef> = {
  "commission.professional_bps": { label: "Professional commission", unit: "bps", schema: int(0, 10000), risky: false, help: "Charged to the professional. Applies to contracts hired after the change." },
  "commission.client_bps": { label: "Client fee", unit: "bps", schema: int(0, 10000), risky: false, help: "Charged to the client. Applies to contracts hired after the change." },
  "payments.min_application_fee_minor": { label: "Minimum Papple fee per payment", unit: "minor", schema: int(0, 1_000_000), risky: false, help: "Minor units (100 = 1.00)." },
  "contracts.min_milestone_minor": { label: "Smallest milestone", unit: "minor", schema: int(0, 100_000_000), risky: false, help: "Minor units." },
  "payments.checkout_expiry_minutes": { label: "Checkout expiry", unit: "minutes", schema: int(30, 1440), risky: false, help: "Stripe requires at least 30 minutes." },
  "reviews.reveal_after_days": { label: "Review reveal delay", unit: "days", schema: int(1, 90), risky: false, help: "A one-sided review becomes visible after this many days." },
  "contracts.max_milestones": { label: "Maximum milestones per contract", unit: "count", schema: int(1, 100), risky: false, help: "" },
  "limits.max_orgs_per_user": { label: "Maximum organizations per user", unit: "count", schema: int(1, 100), risky: false, help: "" },
  "ai.daily_request_cap": { label: "AI daily request cap (all users)", unit: "count", schema: int(0, 1_000_000), risky: false, help: "0 turns AI off until you change it again. Counts requests across the whole platform." },
  "ai.monthly_message_limits": { label: "AI monthly message limits", unit: "json", schema: z.record(z.string().min(1).max(40), int(0, 10_000_000).nullable()), risky: false, help: 'JSON object per plan, null = by contract, e.g. {"free":20}.' },
};
