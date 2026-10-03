import { PublicFooter } from "@/components/PublicFooter";
import { BRAND } from "@/lib/brand";

export default function Home() {
  return (
    <>
    <main className="mx-auto max-w-3xl px-4 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">{BRAND.name}</h1>
      <p className="mt-3 text-lg">{BRAND.tagline}</p>
      <p className="mt-8 text-sm opacity-70">
        {BRAND.name} is a technology platform operated by {BRAND.company}. It is not an employer or
        recruitment agency and does not hold customer funds.
      </p>
    </main>
    <PublicFooter />
    </>
  );
}
