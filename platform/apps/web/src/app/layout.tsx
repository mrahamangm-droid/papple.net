import type { Metadata } from "next";
import { connection } from "next/server";
import { BRAND } from "@/lib/brand";
import { ConsentBanner } from "@/components/ConsentBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: `${BRAND.name} is a technology marketplace and business platform by ${BRAND.company}.`,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection(); // per-request rendering so the CSP nonce can be applied
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
