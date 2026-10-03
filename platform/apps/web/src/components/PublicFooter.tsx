import Link from "next/link";
import { BRAND } from "@/lib/brand";

const LINKS = [
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/cookies", "Cookies"],
  ["/marketplace-rules", "Marketplace rules"],
  ["/status", "Status"],
] as const;

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-neutral-200 px-4 py-6 text-sm text-neutral-600">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <p>© {new Date().getFullYear()} {BRAND.company}</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="underline">{label}</Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
