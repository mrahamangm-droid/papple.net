import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingPanel } from "@/components/bookings/BookingPanel";
import { ContactPanel } from "@/components/marketplace/ContactPanel";
import { JsonLd } from "@/components/marketplace/JsonLd";
import { fromMinor, minorExponent, priceLabel } from "@/lib/marketplace/present";
import type { ServiceCard } from "@/lib/marketplace/search";
import { publicData } from "@/lib/server";

async function load(slug: string) {
  return publicData.service<ServiceCard>(slug);
}

export async function generateMetadata({ params }: PageProps<"/services/[slug]">): Promise<Metadata> {
  const s = await load((await params).slug).catch(() => null);
  if (!s) return { title: "Service not found", robots: { index: false } };
  return {
    title: `${s.title} by ${s.provider_name}`,
    description: s.description.slice(0, 160) || s.title,
    alternates: { canonical: `/services/${s.slug}` },
  };
}

export default async function ServicePage({ params }: PageProps<"/services/[slug]">) {
  const s = await load((await params).slug);
  if (!s) notFound();
  const ld = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.title,
    description: s.description,
    provider: { "@type": "Organization", name: s.provider_name },
    ...(s.price_min != null && s.pricing_model !== "quote"
      ? { offers: { "@type": "Offer", priceCurrency: s.currency, price: fromMinor(s.price_min, s.currency).toFixed(minorExponent(s.currency)) } } : {}),
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={ld} />
      <h1 className="text-3xl font-semibold tracking-tight">{s.title}</h1>
      <p className="mt-1">by <Link href={`/p/${s.provider_slug}`} className="underline">{s.provider_name}</Link> — {s.provider_headline}</p>
      <p className="mt-2 text-sm opacity-70">{[priceLabel(s), s.delivery_days ? `${s.delivery_days} day delivery` : null].filter(Boolean).join(" · ")}</p>
      {s.description && <p className="mt-6 whitespace-pre-line">{s.description}</p>}
      <BookingPanel serviceId={s.id} path={`/services/${s.slug}`} />
      <ContactPanel kind="service" refId={s.id} path={`/services/${s.slug}`} />
    </main>
  );
}
