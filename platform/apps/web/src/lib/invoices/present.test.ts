import { describe, expect, it } from "vitest";
import { INVOICE, invoiceFailureMessage, invoiceTitle, milestoneInvoiceActions, taxLabel } from "./present";

describe("invoice wording", () => {
  it("never claims tax compliance while unreviewed", () => {
    expect(INVOICE.reviewed).toBe(false);
    expect(invoiceTitle("invoice")).toBe("Invoice");
    expect(invoiceTitle("credit_note")).toBe("Credit note");
    expect(INVOICE.note).toMatch(/not been reviewed/i);
    expect(INVOICE.note).not.toMatch(/compliant with/i);
  });
  it("labels tax in plain words", () => {
    expect(taxLabel(0)).toBe("No tax charged");
    expect(taxLabel(500)).toBe("Tax 5%");
    expect(taxLabel(725)).toBe("Tax 7.25%");
  });
  it("has calm fixed messages for every failure", () => {
    for (const c of ["forbidden", "invalid", "notready", "rate", "error"] as const) expect(invoiceFailureMessage(c).length).toBeGreaterThan(10);
    expect(invoiceFailureMessage("notready")).toMatch(/billing details|paid|refund/i);
  });
});

describe("milestoneInvoiceActions", () => {
  const base = { side: "provider" as const, role: "owner", milestoneStatus: "paid", invoice: null, creditNote: null, refunded: false };
  it("lets the provider issue an invoice for a paid milestone", () => {
    expect(milestoneInvoiceActions(base)).toEqual({ issue: true, creditNote: false, view: null });
  });
  it("hides issuing from viewers, clients and unpaid milestones", () => {
    expect(milestoneInvoiceActions({ ...base, role: "viewer" }).issue).toBe(false);
    expect(milestoneInvoiceActions({ ...base, role: "member" }).issue).toBe(false);
    expect(milestoneInvoiceActions({ ...base, side: "client" }).issue).toBe(false);
    expect(milestoneInvoiceActions({ ...base, milestoneStatus: "submitted" }).issue).toBe(false);
  });
  it("shows an existing invoice to both sides and offers a credit note only after a refund", () => {
    const withInvoice = { ...base, invoice: "inv-1" };
    expect(milestoneInvoiceActions(withInvoice)).toEqual({ issue: false, creditNote: false, view: "inv-1" });
    expect(milestoneInvoiceActions({ ...withInvoice, refunded: true }).creditNote).toBe(true);
    expect(milestoneInvoiceActions({ ...withInvoice, refunded: true, side: "client" }).creditNote).toBe(false);
    expect(milestoneInvoiceActions({ ...withInvoice, refunded: true, creditNote: "cn-1" })).toEqual({ issue: false, creditNote: false, view: "inv-1" });
  });
});
