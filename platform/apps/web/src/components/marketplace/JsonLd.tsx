import { headers } from "next/headers";
import { jsonLdScript } from "@/lib/marketplace/present";

/** Structured data for search engines. Carries the CSP nonce and cannot break out of its script element. */
export async function JsonLd({ data }: { data: unknown }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
