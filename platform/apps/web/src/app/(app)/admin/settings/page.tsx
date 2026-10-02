import { AppShell } from "@/components/shell/AppShell";
import { FlagForm, SettingForm } from "@/components/admin/ConsoleForms";
import { SETTINGS } from "@/lib/admin/settings-registry";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const [{ data: rows }, { data: flags }] = await Promise.all([
    db.from("platform_settings").select("key, value").in("key", Object.keys(SETTINGS)),
    db.from("feature_flags").select("key, enabled, description").order("key"),
  ]);
  const values = new Map((rows ?? []).map((r) => [r.key as string, r.value]));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">Every change needs a second factor and a written reason, and is recorded in the audit log. Fee changes apply to contracts hired after the change; existing contracts keep the fees they were hired with.</p>
      <ul className="mt-6 space-y-4">
        {Object.entries(SETTINGS).filter(([k]) => values.has(k)).map(([k, d]) => (
          <li key={k} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <SettingForm settingKey={k} label={d.label} help={d.help} risky={d.risky} current={JSON.stringify(values.get(k))} />
          </li>
        ))}
      </ul>
      <h2 className="mt-10 text-xl font-semibold">Feature flags</h2>
      <ul className="mt-4 space-y-4">
        {(flags ?? []).map((f) => (
          <li key={f.key as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <FlagForm flagKey={f.key as string} enabled={f.enabled as boolean} description={(f.description as string | null) ?? ""} />
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
