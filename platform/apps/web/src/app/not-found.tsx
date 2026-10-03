import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-sm font-medium text-neutral-500">404</p>
      <h1 className="mt-2 text-3xl font-semibold">We could not find that page</h1>
      <p className="mt-3 text-neutral-600">It may have been moved, hidden or never existed on {BRAND.name}.</p>
      <div className="mt-6 flex justify-center gap-4 text-sm">
        <Link href="/" className="underline">Home</Link>
        <Link href="/explore" className="underline">Explore professionals</Link>
      </div>
    </main>
  );
}
