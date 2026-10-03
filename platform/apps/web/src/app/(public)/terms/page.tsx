import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { LEGAL_PAGES } from "@/lib/legal";

const doc = LEGAL_PAGES["terms"];

export const metadata: Metadata = {
  title: doc.title,
  description: doc.description,
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return <LegalPage slug="terms" />;
}
