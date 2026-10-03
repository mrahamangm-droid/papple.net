import type { InvoiceFailure } from "./service";

/** One switch for the invoice template. It stays false until the owner or an accountant has reviewed the template; nothing says "tax invoice" before then. */
export const INVOICE = {
  reviewed: false,
  note: "This document has not been reviewed as a tax invoice. The professional is responsible for the tax details shown.",
} as const;

export const invoiceTitle = (kind: "invoice" | "credit_note") => (kind === "invoice" ? "Invoice" : "Credit note");

export function taxLabel(bps: number): string {
  if (bps === 0) return "No tax charged";
  const pct = bps / 100;
  return `Tax ${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}%`;
}

const MESSAGES: Record<InvoiceFailure, string> = {
  forbidden: "Only an owner or admin of the professional's organization can do that.",
  invalid: "Some of the details are missing or not valid. Please review them and try again.",
  notready: "That is not possible yet. The milestone must be paid, your billing details saved, and a credit note needs a completed refund.",
  rate: "You are doing that too quickly. Please wait a minute and try again.",
  error: "Something went wrong on our side. Nothing was changed. Please try again shortly.",
};
export const invoiceFailureMessage = (code: InvoiceFailure): string => MESSAGES[code];

/** What the contract page offers for one milestone. The database re-checks every one of these. */
export function milestoneInvoiceActions(i: {
  side: "client" | "provider"; role: string; milestoneStatus: string; invoice: string | null; creditNote: string | null; refunded: boolean;
}): { issue: boolean; creditNote: boolean; view: string | null } {
  const canIssue = i.side === "provider" && (i.role === "owner" || i.role === "admin");
  return {
    issue: canIssue && !i.invoice && i.milestoneStatus === "paid",
    creditNote: canIssue && !!i.invoice && !i.creditNote && i.refunded,
    view: i.invoice,
  };
}
