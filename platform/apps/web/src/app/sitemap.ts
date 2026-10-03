import type { MetadataRoute } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { MAX_URLS, buildSitemap, siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Row = { slug: string };

async function slugs(view: "public_provider_cards" | "public_service_cards"): Promise<Row[]> {
  const db = await createServerSupabase();
  const { data, error } = await db.from(view).select("slug").limit(MAX_URLS);
  if (error) throw new Error("unavailable");
  return (data ?? []) as Row[];
}

/** Reads only the whitelisted public views, so hidden or suspended items never appear. A failure degrades to the static pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  const [providers, services] = await Promise.all([slugs("public_provider_cards").catch(() => []), slugs("public_service_cards").catch(() => [])]);
  return buildSitemap(base, { providers, services });
}
