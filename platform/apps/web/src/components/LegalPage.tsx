import { LEGAL, LEGAL_PAGES, PLACEHOLDER, show, type LegalSlug } from "@/lib/legal";
import { BRAND } from "@/lib/brand";

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL_PAGES[slug];
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {!LEGAL.reviewed && (
        <p role="note" className="mb-6 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          Draft — pending legal review. This text describes how {BRAND.name} works today and may change before launch.
        </p>
      )}
      <h1 className="text-3xl font-semibold">{doc.title}</h1>
      <p className="mt-1 text-sm text-neutral-600">Version {LEGAL.version} · Last updated {LEGAL.updated}</p>
      <nav aria-label="On this page" className="mt-6 text-sm">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {doc.sections.map((s) => (
            <li key={s.id}><a className="underline" href={`#${s.id}`}>{s.title}</a></li>
          ))}
        </ul>
      </nav>
      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="mt-8">
          <h2 className="text-xl font-semibold">{s.title}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-2 leading-7">{p}</p>
          ))}
        </section>
      ))}
      <section id="contact" className="mt-10 border-t pt-6 text-sm">
        <h2 className="text-xl font-semibold">Contact and company details</h2>
        <p className="mt-2">{BRAND.company}</p>
        <p>Registered address: <span data-placeholder={LEGAL.address === null}>{show(LEGAL.address)}</span></p>
        <p>Licence: <span data-placeholder={LEGAL.licence === null}>{show(LEGAL.licence)}</span></p>
        <p>Governing law: <span data-placeholder={LEGAL.governingLaw === null}>{show(LEGAL.governingLaw)}</span></p>
        <p>Contact: <span data-placeholder={LEGAL.contactEmail === null}>{show(LEGAL.contactEmail)}</span></p>
        {!LEGAL.reviewed && <p className="mt-2 text-neutral-600">Items marked “{PLACEHOLDER}” will be filled before launch.</p>}
      </section>
    </main>
  );
}
