import { AppShell } from "@/components/shell/AppShell";
import { RoleForm } from "@/components/admin/ConsoleForms";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const { data } = await db.from("platform_roles").select("user_id, role").order("role");
  const ids = [...new Set((data ?? []).map((r) => r.user_id as string))];
  const { data: profs } = ids.length ? await db.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
  const names = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? ""]));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Staff</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">You cannot change your own role, and the last administrator cannot be removed. Roles take effect on the person&apos;s next request.</p>
      <ul className="mt-6 space-y-4">
        {(data ?? []).map((r) => (
          <li key={`${r.user_id}-${r.role}`} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{names.get(r.user_id as string) || "Unnamed"} <span className="text-xs opacity-70">{r.role as string} · {r.user_id as string}</span></p>
            {r.user_id !== ctx.userId && <RoleForm userId={r.user_id as string} role={r.role as "admin" | "support"} grant={false} />}
          </li>
        ))}
      </ul>
      <h2 className="mt-10 text-xl font-semibold">Add staff</h2>
      <div className="mt-3 max-w-md"><RoleForm grant /></div>
    </AppShell>
  );
}
