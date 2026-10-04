import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageList } from "./MessageList";
import { OrgPicker } from "./OrgPicker";
import { ProposalList } from "./ProposalList";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const O1 = { id: "11111111-1111-4111-8111-111111111111", name: "Acme Studio" };
const O2 = { id: "22222222-1111-4111-8111-111111111111", name: "Beta Agency" };

describe("OrgPicker", () => {
  it("auto-selects a single organization with a hidden field and no select", () => {
    const out = html(h(OrgPicker, { orgs: [O1] }));
    expect(out).toContain(`type="hidden"`);
    expect(out).toContain(`name="orgId"`);
    expect(out).toContain(O1.id);
    expect(out).toContain("Acme Studio");
    expect(out).not.toContain("<select");
  });
  it("shows a labelled select when there are several organizations and defaults to none", () => {
    const out = html(h(OrgPicker, { orgs: [O1, O2] }));
    expect(out).toContain("<select");
    expect(out).toContain(`name="orgId"`);
    expect(out).toContain("Acting as");
    expect(out).toContain(O2.id);
    expect(out).toMatch(/<option value=""[^>]*selected/); // only the placeholder is preselected
    expect(out).not.toMatch(new RegExp(`<option value="${O1.id}"[^>]*selected`));
    expect(out).not.toMatch(new RegExp(`<option value="${O2.id}"[^>]*selected`));
  });
  it("explains when there is no eligible organization", () => {
    expect(html(h(OrgPicker, { orgs: [] }))).toContain("not allowed");
  });
});

const row = (id: string, org: string, extra = {}) => ({ id, orgName: org, coverLetter: "I can do it", price: 150000, currency: "USD", deliveryDays: 14, status: "submitted", ...extra });

describe("ProposalList", () => {
  it("renders exactly the rows it is given, no more", () => {
    const out = html(h(ProposalList, { proposals: [row("a", "Acme Studio")] }));
    expect(out).toContain("Acme Studio");
    expect(out).not.toContain("Beta Agency");
    expect(out).toContain("$1,500.00");
    expect(out).toContain("14 days");
  });
  it("shows the empty state", () => {
    expect(html(h(ProposalList, { proposals: [] }))).toContain("No proposals yet");
  });
  it("renders action slots only when provided", () => {
    const withSlot = html(h(ProposalList, { proposals: [row("a", "Acme")], renderActions: (p) => h("button", null, `decide ${p.id}`) }));
    expect(withSlot).toContain("decide a");
    expect(html(h(ProposalList, { proposals: [row("a", "Acme")] }))).not.toContain("<button");
  });
  it("renders hostile text as text", () => {
    const out = html(h(ProposalList, { proposals: [row("a", "<img src=x onerror=alert(1)>", { coverLetter: "<script>alert(1)</script>" })] }));
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
  });
});

describe("MessageList", () => {
  it("renders message bodies as escaped text", () => {
    const out = html(h(MessageList, { messages: [{ id: "m1", senderName: "Eve", mine: false, body: "<script>alert(1)</script>", createdAt: "2026-10-02T10:00:00Z" }] }));
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("marks the viewer's own messages for assistive tech", () => {
    const out = html(h(MessageList, { messages: [{ id: "m1", senderName: "Me", mine: true, body: "hi", createdAt: "2026-10-02T10:00:00Z" }] }));
    expect(out).toContain("You");
  });
  it("shows an empty state", () => {
    expect(html(h(MessageList, { messages: [] }))).toContain("No messages yet");
  });
});
