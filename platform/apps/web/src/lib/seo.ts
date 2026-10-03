import type { MetadataRoute } from "next";
import { PROTECTED_EXACT, PROTECTED_PREFIXES } from "./route-gate";
import { isValidSlug } from "./marketplace/public-data";
import { LEGAL_SLUGS } from "./legal";

export const DEFAULT_SITE = "https://papple.net";
export const MAX_URLS = 5000;

/** Origin only, http(s) only; anything else falls back to the production domain. */
export function siteUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_SITE;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : DEFAULT_SITE;
  } catch {
    return DEFAULT_SITE;
  }
}

export function buildRobots(base: string): MetadataRoute.Robots {
  const disallow = [
    "/api/",
    ...PROTECTED_PREFIXES.flatMap((p) => [`${p}/`, `${p}$`]),
    ...PROTECTED_EXACT.map((p) => `${p}$`),
  ];
  return { rules: [{ userAgent: "*", allow: "/", disallow }], sitemap: `${base}/sitemap.xml` };
}

export interface SitemapInput { providers: { slug: string }[]; services: { slug: string }[] }

export function buildSitemap(base: string, input: SitemapInput, now: Date = new Date()): MetadataRoute.Sitemap {
  const stat = ["/", "/explore", ...LEGAL_SLUGS.map((s) => `/${s}`)];
  const out: MetadataRoute.Sitemap = stat.map((p) => ({ url: `${base}${p === "/" ? "" : p}${p === "/" ? "/" : ""}`, lastModified: now }));
  const dyn = (prefix: string, rows: { slug: string }[]) => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.size >= MAX_URLS) break;
      if (typeof r.slug === "string" && isValidSlug(r.slug)) seen.add(r.slug);
    }
    for (const s of seen) out.push({ url: `${base}${prefix}/${s}`, lastModified: now });
  };
  dyn("/p", input.providers);
  dyn("/services", input.services);
  return out;
}
