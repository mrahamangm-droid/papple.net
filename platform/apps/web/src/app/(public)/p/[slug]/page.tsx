import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactPanel } from "@/components/marketplace/ContactPanel";
import { JsonLd } from "@/components/marketplace/JsonLd";
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
  const ld = {
    "@context": "https://schema.org",
    "@type": p.entity_type === "individual" ? "Person" : "Organization",
    name: p.display_name,
    description: p.headline,
    ...(p.country ? { address: { "@type": "PostalAddress", addressCountry: p.country } } : {}),
    ...(p.skills.length ? { knowsAbout: p.skills } : {}),
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={ld} />
      <h1 className="text-3xl font-semibold tracking-tight">{p.display_name}</h1>
      <p className="mt-1 text-lg">{p.headline}</p>
      <p className="mt-2 text-sm opacity-70">{[p.country, rate, `Availability: ${p.availability}`].filter(Boolean).join(" · ")}</p>
      {p.summary && <p className="mt-6 whitespace-pre-line">{p.summary}</p>}
      {p.skills.length > 0 && (<><h2 className="mt-8 text-lg font-semibold">Skills</h2><p>{p.skills.join(", ")}</p></>)}
      <ContactPanel kind="profile" refId={p.id} path={`/p/${p.slug}`} />
    </main>
  );
}
