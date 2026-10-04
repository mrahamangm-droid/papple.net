import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactPanel } from "@/components/marketplace/ContactPanel";
import { JsonLd } from "@/components/marketplace/JsonLd";
import { VerifiedBadge } from "@/components/marketplace/VerifiedBadge";
import { RatingSummary } from "@/components/contracts/RatingSummary";
import { VERIFIED_COPY } from "@/lib/admin/present";
import { CHECKED_COPY, kindLabel, statusLabel } from "@/lib/credentials/present";
import { rateLabel } from "@/lib/marketplace/present";
import type { ProviderCard } from "@/lib/marketplace/search";
import { publicData } from "@/lib/server";

async function load(slug: string) {
  return publicData.provider<ProviderCard>(slug);
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const p = await load((await params).slug).catch(() => null);
  if (!p) return { title: "Profile not found", robots: { index: false } };
  return {
    title: `${p.display_name} — ${p.headline}`,
    description: p.summary.slice(0, 160) || p.headline,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title: `${p.display_name} — ${p.headline}`, type: "profile" },
  };
}

export default async function ProviderPage({ params }: PageProps<"/p/[slug]">) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const rate = rateLabel(p);
  const [rating, credentials] = await Promise.all([publicData.rating(p.slug), publicData.credentials(p.slug)]);
  const ld = {
    "@context": "https://schema.org",
    "@type": p.entity_type === "individual" ? "Person" : "Organization",
    name: p.display_name,
    description: p.headline,
    ...(p.country ? { address: { "@type": "PostalAddress", addressCountry: p.country } } : {}),
    ...(p.skills.length ? { knowsAbout: p.skills } : {}),
    ...(rating.count > 0 && rating.avg !== null ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.avg, reviewCount: rating.count, bestRating: 5, worstRating: 1 } } : {}),
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={ld} />
      <h1 className="text-3xl font-semibold tracking-tight">{p.display_name}{p.verified && <VerifiedBadge />}</h1>
      <p className="mt-1 text-lg">{p.headline}</p>
      <p className="mt-2 text-sm opacity-70">{[p.country, rate, `Availability: ${p.availability}`].filter(Boolean).join(" · ")}</p>
      <RatingSummary avg={rating.avg} count={rating.count} />
      {p.verified && <p className="mt-2 text-xs opacity-70">{VERIFIED_COPY}</p>}
      {p.summary && <p className="mt-6 whitespace-pre-line">{p.summary}</p>}
      {p.skills.length > 0 && (<><h2 className="mt-8 text-lg font-semibold">Skills</h2><p>{p.skills.join(", ")}</p></>)}
      {credentials.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold">Credentials</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {credentials.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.title}</span> <span className="opacity-70">{kindLabel(c.kind)} · {c.issuer}{c.expiresOn ? ` · expires ${c.expiresOn}` : ""}</span>{" "}
                <span className={c.status === "checked" ? "rounded-full border border-emerald-600 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400" : "rounded-full border border-neutral-400 px-2 py-0.5 text-xs"}>{statusLabel(c.status)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{CHECKED_COPY}</p>
        </>
      )}
      <ContactPanel kind="profile" refId={p.id} path={`/p/${p.slug}`} />
    </main>
  );
}
