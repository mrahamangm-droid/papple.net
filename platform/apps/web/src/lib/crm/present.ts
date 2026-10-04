import type { CrmFailure, CsvFailure } from "./service";

export const STAGES = ["lead", "proposal", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = { lead: "Lead", proposal: "Proposal sent", won: "Won", lost: "Lost" };
export const stageLabel = (s: string): string => STAGE_LABEL[s as Stage] ?? "Unknown";

const MESSAGES: Record<CrmFailure | CsvFailure, string> = {
  forbidden: "You do not have permission to do that for this organization.",
  invalid: "Some details are missing or not valid. Check them and try again.",
  limit: "Your plan's contact limit is reached. Upgrade your plan or delete contacts you no longer need.",
  duplicate: "A contact with that email address already exists.",
  rate: "You are going a little fast. Wait a moment and try again.",
  error: "Something went wrong. Please try again.",
  csv_empty: "The file is empty.",
  csv_too_big: "The file is too large. Keep it under 512 KB.",
  csv_too_many_rows: "The file has too many rows. Import at most 500 contacts at a time.",
  csv_bad_format: "The file could not be read as CSV. Check the quotes and separators.",
  csv_no_name_column: "The first row must contain a column called Name (and optionally Email, Company, Phone).",
};
export const crmFailureMessage = (code: CrmFailure | CsvFailure): string => MESSAGES[code] ?? MESSAGES.error;

/** Whole currency units with the ISO code, e.g. "AED 5,000.00". Values are stored in minor units (two decimals). */
export function formatDealValue(value: number | null, currency: string | null): string {
  if (value === null || currency === null) return "No value";
  return `${currency} ${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface ImportReport { imported: number; duplicate: number; invalidLines: number[]; limit: number }

export function describeImport(r: ImportReport): string {
  const parts = [`${r.imported} imported`];
  if (r.duplicate) parts.push(`${r.duplicate} skipped as duplicates`);
  if (r.limit) parts.push(`${r.limit} not imported because your plan's contact limit was reached`);
  if (r.invalidLines.length) {
    const shown = r.invalidLines.slice(0, 10).join(", ");
    parts.push(`${r.invalidLines.length} skipped as invalid (file line${r.invalidLines.length === 1 ? "" : "s"} ${shown}${r.invalidLines.length > 10 ? ", …" : ""})`);
  }
  return parts.join("; ") + ".";
}

import type { EmailFailure } from "./email";

const EMAIL_MESSAGES: Record<EmailFailure, string> = {
  forbidden: "You do not have permission to email this contact.",
  invalid: "Check the subject and message. The subject must be one line and neither field can be empty.",
  notready: "Email is not available for this contact yet. Record why you may email them, save your billing details (they appear in the footer), and make sure email is switched on for your account.",
  suppressed: "This address has unsubscribed, bounced or complained, so you cannot email it again.",
  limit: "You have reached today's email limit for your plan. Try again tomorrow or upgrade your plan.",
  rate: "You are going a little fast. Wait a moment and try again.",
  send_failed: "The message was not sent because the email provider refused it. Nothing was counted against your daily limit.",
  unconfirmed: "We could not confirm whether the message was sent. It may have been delivered, so check with the contact before sending it again. It counts toward today's limit.",
  error: "Something went wrong. Please try again.",
};
export const emailFailureMessage = (code: EmailFailure): string => EMAIL_MESSAGES[code] ?? EMAIL_MESSAGES.error;

const BASIS_LABEL: Record<string, string> = { existing_client: "Existing client", opted_in: "Asked to receive email", requested_contact: "Asked me to contact them" };
export const basisLabel = (b: string | null): string => (b ? BASIS_LABEL[b] ?? "Not recorded" : "Not recorded");
