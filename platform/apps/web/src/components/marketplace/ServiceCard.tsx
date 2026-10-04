import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { priceLabel } from "@/lib/marketplace/present";
import type { ServiceCard as S } from "@/lib/marketplace/search";

export function ServiceCard({ s }: { s: S }) {
  return (
    <Card>
      <h3 className="text-base font-semibold"><Link href={`/services/${s.slug}`} className="hover:underline">{s.title}</Link></h3>
      <p className="text-sm">by <Link href={`/p/${s.provider_slug}`} className="underline">{s.provider_name}</Link></p>
      <p className="mt-1 text-xs opacity-70">{[priceLabel(s), s.delivery_days ? `${s.delivery_days} day delivery` : null].filter(Boolean).join(" · ")}</p>
    </Card>
  );
}
