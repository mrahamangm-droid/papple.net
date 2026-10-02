import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { navFor, type AuthContext } from "@/lib/rbac";
import { signOutAction } from "@/app/(auth)/actions";

export function AppShell({ ctx, children }: { ctx: AuthContext; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link href="/dashboard" className="font-semibold">{BRAND.name}</Link>
          <ul className="flex flex-1 gap-4 text-sm">
            {navFor(ctx).map((i) => (
              <li key={i.href}><Link href={i.href} className="hover:underline">{i.label}</Link></li>
            ))}
          </ul>
          <form action={signOutAction}><button className="text-sm underline">Sign out</button></form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
