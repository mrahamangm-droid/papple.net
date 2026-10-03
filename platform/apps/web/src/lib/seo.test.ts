import { describe, expect, it } from "vitest";
import { isProtectedPath, PROTECTED_PREFIXES } from "./route-gate";
import { buildRobots, buildSitemap, siteUrl, MAX_URLS } from "./seo";

describe("siteUrl", () => {
  it("defaults to papple.net", () => expect(siteUrl(undefined)).toBe("https://papple.net"));
  it("strips trailing slashes", () => expect(siteUrl("https://papple.net///")).toBe("https://papple.net"));
  it("rejects non-http values", () => expect(siteUrl("javascript:alert(1)")).toBe("https://papple.net"));
  it("rejects garbage", () => expect(siteUrl("not a url")).toBe("https://papple.net"));
  it("keeps only the origin", () => expect(siteUrl("https://x.example/some/path?q=1")).toBe("https://x.example"));
});

describe("buildRobots", () => {
  const r = buildRobots("https://papple.net");
  const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
  const dis = [rule.disallow].flat();
  it("disallows api, admin and every gated prefix", () => {
    expect(dis).toContain("/api/");
    for (const p of PROTECTED_PREFIXES) expect(dis).toContain(`${p}/`);
  });
  it("blocks the services manager but not service pages", () => {
    expect(dis).toContain("/services$");
    expect(dis.some((d) => d === "/services/")).toBe(false);
  });
  it("never disallows a public path", () => {
    for (const d of dis as string[]) {
      const path = d.replace(/\$$/, "").replace(/\/$/, "");
      expect(path === "/api" || isProtectedPath(path)).toBe(true);
    }
  });
  it("blocks each gated prefix exactly too", () => {
    for (const p of PROTECTED_PREFIXES) expect(dis).toContain(`${p}$`);
  });
  it("points at the sitemap", () => expect(r.sitemap).toBe("https://papple.net/sitemap.xml"));
});

describe("buildSitemap", () => {
  const base = "https://papple.net";
  const urls = (e: ReturnType<typeof buildSitemap>) => e.map((x) => x.url);
  it("includes static public pages", () => {
    const u = urls(buildSitemap(base, { providers: [], services: [] }));
    for (const p of ["/", "/explore", "/terms", "/privacy", "/cookies", "/marketplace-rules"]) expect(u).toContain(`${base}${p}`);
  });
  it("adds provider and service pages", () => {
    const u = urls(buildSitemap(base, { providers: [{ slug: "jane-doe" }], services: [{ slug: "logo-design" }] }));
    expect(u).toContain(`${base}/p/jane-doe`);
    expect(u).toContain(`${base}/services/logo-design`);
  });
  it("drops invalid slugs and duplicates", () => {
    const u = urls(buildSitemap(base, { providers: [{ slug: "ok" }, { slug: "ok" }, { slug: "../admin" }, { slug: "Bad Slug" }, { slug: "" }], services: [] }));
    expect(u.filter((x) => x.endsWith("/p/ok"))).toHaveLength(1);
    expect(u.some((x) => x.includes("admin") || x.includes("Bad"))).toBe(false);
  });
  it("never lists a gated path", () => {
    const u = buildSitemap(base, { providers: [], services: [] }).map((x) => new URL(x.url).pathname);
    expect(u.filter(isProtectedPath)).toEqual([]);
  });
  it("caps each kind", () => {
    const many = Array.from({ length: MAX_URLS + 10 }, (_, i) => ({ slug: `s${i}` }));
    const u = urls(buildSitemap(base, { providers: many, services: [] })).filter((x) => x.includes("/p/"));
    expect(u).toHaveLength(MAX_URLS);
  });
});
