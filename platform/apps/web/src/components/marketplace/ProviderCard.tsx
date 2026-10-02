import Link from "next/link";
import { VerifiedBadge } from "./VerifiedBadge";
import { Card } from "@/components/ui/Card";
import { rateLabel } from "@/lib/marketplace/present";
import type { ProviderCard as P } from "@/lib/marketplace/search";

export function ProviderCard({ p }: { p: P }) {
  const rate = rateLabel(p);
  return (
    <Card>
      <h3 className="text-base font-semibold"><Link href={`/p/${p.slug}`} className="hover:underline">{p.display_name}</Link>{p.verified && <VerifiedBadge />}</h3>
      <p className="text-sm">{p.headline}</p>
      <p className="mt-1 text-xs opacity-70">
        {[p.country, rate, p.availability === "available" ? "Available" : p.availability === "limited" ? "Limited availability" : "Not available"].filter(Boolean).join(" · ")}
      </p>
      {p.skills.length > 0 && <p className="mt-2 text-xs">{p.skills.slice(0, 6).join(", ")}</p>}
    </Card>
  );
}
