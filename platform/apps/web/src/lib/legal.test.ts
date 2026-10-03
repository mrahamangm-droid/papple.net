import { describe, expect, it } from "vitest";
import { LEGAL, PLACEHOLDER, show, LEGAL_PAGES, LEGAL_SLUGS } from "./legal";

describe("legal constants", () => {
  it("renders null as the visible placeholder", () => expect(show(null)).toBe(PLACEHOLDER));
  it("renders a real value as is", () => expect(show("Dubai")).toBe("Dubai"));
  it("never claims review while placeholders remain", () => {
    const text = JSON.stringify(LEGAL_PAGES);
    if (LEGAL.reviewed) expect(text).not.toContain(PLACEHOLDER);
    const open = Object.values({ a: LEGAL.address, l: LEGAL.licence, g: LEGAL.governingLaw, c: LEGAL.contactEmail }).some((v) => v === null);
    if (open) expect(LEGAL.reviewed).toBe(false);
  });
});

describe("legal pages", () => {
  it("has the four pages", () => expect([...LEGAL_SLUGS].sort()).toEqual(["cookies", "marketplace-rules", "privacy", "terms"]));
  it.each([...LEGAL_SLUGS])("%s is substantial and clean", (slug) => {
    const p = LEGAL_PAGES[slug]!;
    expect(p.sections.length).toBeGreaterThanOrEqual(4);
    expect(new Set(p.sections.map((s) => s.id)).size).toBe(p.sections.length);
    for (const s of p.sections) expect(s.body.every((b) => b.trim().length > 20)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/todo|lorem|tbd/i);
    expect(p.description.length).toBeLessThanOrEqual(160);
  });
  it("describes the real product", () => {
    const t = JSON.stringify(LEGAL_PAGES.terms);
    expect(t).toMatch(/not (the|an) employer/i);
    expect(t).toMatch(/does not hold/i);
    const p = JSON.stringify(LEGAL_PAGES.privacy);
    for (const v of ["Stripe", "Supabase", "Resend"]) expect(p).toContain(v);
    expect(JSON.stringify(LEGAL_PAGES.cookies)).toMatch(/essential/i);
  });
});

describe("legal text matches what the product actually does", () => {
  const all = JSON.stringify(LEGAL_PAGES);
  it("promises no partial refund, retention setting, appeal channel or message reporting", () => {
    expect(all).not.toMatch(/partial refund/i);
    expect(all).not.toMatch(/retention shown/i);
    expect(all).not.toMatch(/reply through the platform/i);
    expect(all).not.toMatch(/report on a profile, service, project or message/i);
    expect(all).not.toMatch(/shown before you commit/i);
  });
  it("describes the refund ruling as it works", () => expect(JSON.stringify(LEGAL_PAGES.terms)).toMatch(/refund.*(all|every).*payment.*cancel/i));
  it("discloses the optional AI assistant and its processor", () => {
    const p = JSON.stringify(LEGAL_PAGES.privacy);
    expect(p).toContain("Anthropic");
    expect(p).toMatch(/AI assistant/i);
    expect(p).toMatch(/only (the )?text you (submit|choose)/i);
    expect(p).toMatch(/never.*(chat )?messages/i);
  });
  it("lists every processor the code sends data to", () => {
    const p = JSON.stringify(LEGAL_PAGES.privacy);
    for (const v of ["Sentry", "PostHog", "Upstash", "Vercel"]) expect(p).toContain(v);
  });
});
