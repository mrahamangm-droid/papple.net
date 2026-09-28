const FOCUS_AREAS = [
  {
    title: "Global Advisory",
    body:
      "Advisory support for construction and infrastructure leadership — strategic visioning, delivery governance, and executive decision-making under real project constraints.",
  },
  {
    title: "Construction Intelligence",
    body:
      "Applying AI-assisted analysis inside the delivery process while keeping judgement, accountability and people-centred delivery with the human leader, not the system.",
  },
  {
    title: "Verified Expert Network",
    body:
      "A curated network model for construction and infrastructure expertise — in active development, built on reviewed credentials rather than a self-service marketplace.",
  },
];

const RESEARCH_LINKS = [
  {
    label: "AI-GCLM Readiness Assessment (free tool)",
    href: "https://mrahamangm-droid.github.io/aigclm-readiness/",
    note: "A browser-based self-assessment implementing the six-pillar AI-GCLM framework. No install, no data leaves the browser.",
  },
  {
    label: "Published research archive",
    href: "https://github.com/mrahamangm-droid/construction-research",
    note: "Open-access papers on AI in construction leadership and infrastructure delivery — the GCLM / AI-GCLM framework line.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-16 px-6 py-20">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-wide text-secondary">
          Papple Holdings Advisory Network
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">
          Global Advisory, Construction Intelligence &amp; Verified Expert Network
        </h1>
        <p className="max-w-xl text-base text-primary/70">
          Advisory work for construction and infrastructure leadership, grounded in
          applied AI research rather than off-the-shelf benchmarks. Based in Ras
          Al Khaimah, UAE.
        </p>
      </header>

      <section aria-labelledby="focus-heading" className="flex flex-col gap-6">
        <h2 id="focus-heading" className="text-xl font-semibold text-primary">
          What this covers
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {FOCUS_AREAS.map((area) => (
            <div
              key={area.title}
              className="rounded-lg border border-neutral-line bg-white/60 p-5 shadow-card"
            >
              <h3 className="mb-2 font-medium text-secondary">{area.title}</h3>
              <p className="text-sm text-primary/70">{area.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="research-heading" className="flex flex-col gap-6">
        <h2 id="research-heading" className="text-xl font-semibold text-primary">
          Research and tools
        </h2>
        <ul className="flex flex-col gap-4">
          {RESEARCH_LINKS.map((link) => (
            <li
              key={link.href}
              className="rounded-lg border border-neutral-line bg-white/60 p-5 shadow-card"
            >
              <a
                href={link.href}
                className="font-medium text-accent-600 underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                {link.label}
              </a>
              <p className="mt-1 text-sm text-primary/70">{link.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="flex flex-col gap-2 border-t border-neutral-line pt-8 text-sm text-primary/60">
        <p>Mohammad Habibur Rahaman — Civil engineer and construction executive</p>
        <p>
          <a className="underline underline-offset-2" href="https://mrahaman.com/" target="_blank" rel="noreferrer">
            mrahaman.com
          </a>
          {" · "}
          <a className="underline underline-offset-2" href="mailto:m.rahaman.gm@gmail.com">
            m.rahaman.gm@gmail.com
          </a>
        </p>
        <p className="pt-4 text-xs text-primary/40">
          This site is under active development. Accounts, the expert network application
          flow and additional advisory pages are being built out in stages.
        </p>
      </footer>
    </main>
  );
}
