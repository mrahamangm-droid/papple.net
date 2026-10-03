import type { MetadataRoute } from "next";
import { buildRobots, siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteUrl(process.env.NEXT_PUBLIC_SITE_URL));
}
