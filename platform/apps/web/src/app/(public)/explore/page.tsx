import type { Metadata } from "next";
import Link from "next/link";
import { ProviderCard } from "@/components/marketplace/ProviderCard";
import { SearchForm } from "@/components/marketplace/SearchForm";
import { ServiceCard } from "@/components/marketplace/ServiceCard";
import { searchParams } from "@/lib/marketplace/validators";
import type { Page, ProviderCard as ProviderCardData, ServiceCard as ServiceCardData } from "@/lib/marketplace/search";
import { guardedSearch, publicCategories } from "@/lib/server";

export const metadata: Metadata = {
  title: "Explore professionals and services",
  description: "Find verified-by-reviews professionals, agencies and services across every trade and profession.",
  alternates: { canonical: "/explore" },
};

export default async function Explore({ searchParams: sp }: PageProps<"/explore">) {
  const raw = Object.fromEntries(Object.entries(await sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = searchParams.safeParse({ kind: "providers", ...raw });
  const params = parsed.success ? parsed.data : searchParams.parse({ kind: "providers" });
  const categories = await publicCategories();

  const result = await guardedSearch(params);
  const failed = result.status === "error";
  const limited = result.status === "rate";
  const page = result.status === "ok" ? (result.page as { items: unknown[]; nextCursor: string | null }) : null;
  const providers = page && params.kind === "providers" ? (page as Page<ProviderCardData>) : null;
  const services = page && params.kind === "services" ? (page as Page<ServiceCardData>) : null;
  const next = page?.nextCursor
    ? `/explore?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), kind: params.kind, ...(params.category ? { category: params.category } : {}), ...(params.country ? { country: params.country } : {}), cursor: page.nextCursor })}`
    : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Explore the marketplace</h1>
      <p className="mt-2 text-sm opacity-80">Search professionals and services. Contact details are shared only inside the platform.</p>
      <div className="mt-6"><SearchForm kind={params.kind} q={params.q} category={params.category} country={params.country} categories={categories} /></div>
      <section aria-label="Results" className="mt-8">
        {failed && <p role="status">Search is temporarily unavailable. Please try again shortly.</p>}
        {limited && <p role="status">You are searching too quickly. Please wait a minute and try again.</p>}
        {!failed && !limited && page && page.items.length === 0 && <p role="status">No results yet. Try a broader search.</p>}
        <ul className="grid gap-4 sm:grid-cols-2">
          {providers?.items.map((p) => <li key={p.id}><ProviderCard p={p} /></li>)}
          {services?.items.map((s) => <li key={s.id}><ServiceCard s={s} /></li>)}
        </ul>
        {next && <p className="mt-6"><Link href={next} className="underline">Next page</Link></p>}
      </section>
    </main>
  );
}
