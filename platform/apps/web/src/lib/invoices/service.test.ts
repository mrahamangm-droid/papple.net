import { describe, expect, it, vi } from "vitest";
import { createInvoiceService, type InvoiceDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const CON = "22222222-2222-4222-8222-222222222222";
const MIL = "33333333-3333-4333-8333-333333333333";
const INV = "44444444-4444-4444-8444-444444444444";

function deps(over: Partial<InvoiceDeps> = {}): InvoiceDeps & { rpc: ReturnType<typeof vi.fn>; revalidate: ReturnType<typeof vi.fn> } {
  return {
    getUserId: async () => "u1",
    throttle: async () => true,
    rpc: vi.fn(async () => ({ data: INV, error: null })),
    revalidate: vi.fn(),
    ...over,
  } as never;
}

describe("issue", () => {
  it("issues through the RPC and refreshes the contract page", async () => {
    const d = deps();
    expect(await createInvoiceService(d).issue({ orgId: ORG, contractId: CON, milestoneId: MIL })).toEqual({ ok: true, id: INV });
    expect(d.rpc).toHaveBeenCalledWith("issue_invoice", { p_org: ORG, p_milestone: MIL });
    expect(d.revalidate).toHaveBeenCalledWith(`/contracts/${CON}`);
  });
  it("rejects bad input and signed-out callers before any call", async () => {
    const d = deps();
    const s = createInvoiceService(d);
    expect(await s.issue({ orgId: "x", contractId: CON, milestoneId: MIL })).toEqual({ ok: false, code: "invalid" });
    expect(await createInvoiceService(deps({ getUserId: async () => null })).issue({ orgId: ORG, contractId: CON, milestoneId: MIL })).toEqual({ ok: false, code: "forbidden" });
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it("maps database codes to fixed results", async () => {
    const run = async (code: string) => createInvoiceService(deps({ rpc: vi.fn(async () => ({ data: null, error: { code } })) as never })).issue({ orgId: ORG, contractId: CON, milestoneId: MIL });
    expect(await run("42501")).toEqual({ ok: false, code: "forbidden" });
    expect(await run("55000")).toEqual({ ok: false, code: "notready" });
    expect(await run("22023")).toEqual({ ok: false, code: "invalid" });
    expect(await run("XX000")).toEqual({ ok: false, code: "error" });
  });
  it("rate limits, and a broken limiter fails closed", async () => {
    expect(await createInvoiceService(deps({ throttle: async () => false })).issue({ orgId: ORG, contractId: CON, milestoneId: MIL })).toEqual({ ok: false, code: "rate" });
    expect(await createInvoiceService(deps({ throttle: async () => { throw new Error("down"); } })).issue({ orgId: ORG, contractId: CON, milestoneId: MIL })).toEqual({ ok: false, code: "error" });
  });
});

describe("creditNote", () => {
  it("issues a credit note for an invoice", async () => {
    const d = deps();
    expect(await createInvoiceService(d).creditNote({ orgId: ORG, contractId: CON, invoiceId: INV })).toEqual({ ok: true, id: INV });
    expect(d.rpc).toHaveBeenCalledWith("issue_credit_note", { p_org: ORG, p_invoice: INV });
  });
});

describe("saveProfile", () => {
  const input = { orgId: ORG, legalName: "  Provider LLC ", address: "Office 1, Dubai", country: "ae", taxNumber: " TRN-1 ", taxPercent: 5 };
  it("normalises and sends the profile", async () => {
    const d = deps({ rpc: vi.fn(async () => ({ data: null, error: null })) as never });
    expect(await createInvoiceService(d).saveProfile(input)).toEqual({ ok: true });
    expect(d.rpc).toHaveBeenCalledWith("save_billing_profile", { p_org: ORG, p_legal_name: "Provider LLC", p_address: "Office 1, Dubai", p_country: "AE", p_tax_number: "TRN-1", p_tax_bps: 500 });
    expect(d.revalidate).toHaveBeenCalledWith("/settings/invoicing");
  });
  it("converts percentages with decimals to basis points and sends a blank tax number as null", async () => {
    const d = deps({ rpc: vi.fn(async () => ({ data: null, error: null })) as never });
    await createInvoiceService(d).saveProfile({ ...input, taxNumber: "  ", taxPercent: 0 });
    expect(d.rpc).toHaveBeenCalledWith("save_billing_profile", expect.objectContaining({ p_tax_number: null, p_tax_bps: 0 }));
    await createInvoiceService(d).saveProfile({ ...input, taxPercent: 7.25 });
    expect(d.rpc).toHaveBeenLastCalledWith("save_billing_profile", expect.objectContaining({ p_tax_bps: 725 }));
  });
  it("rejects out-of-range or malformed profiles", async () => {
    const s = createInvoiceService(deps());
    for (const bad of [{ taxPercent: 101 }, { taxPercent: -1 }, { country: "UAE" }, { legalName: "A" }, { address: "x" }, { taxPercent: Number.NaN }]) {
      expect(await s.saveProfile({ ...input, ...bad })).toEqual({ ok: false, code: "invalid" });
    }
  });
});
