import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Status", description: `Service status for ${BRAND.name}.`, alternates: { canonical: "/status" } };

export default function StatusPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Status</h1>
      <p className="mt-3" role="status">If you can read this page, the {BRAND.name} web app is running.</p>
      <p className="mt-2 text-sm text-neutral-600">Individual features such as payments or email can be affected separately. For help, use the contact details on our legal pages.</p>
    </main>
  );
}
