import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { requireCapability } from "@/lib/auth-context";
import { parseWindow, splitSummary } from "@/lib/ai/present";
import { aiKeyConfigured } from "@/lib/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "AI usage" };
export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString("en-US");

export default async function AiUsagePage({ searchParams }: PageProps<"/admin/ai">) {
  const ctx = await requireCapability("platform.admin");
  const days = parseWindow((await searchParams).days);
  const db = await createServerSupabase();
  const [summary, flag, cap] = await Promise.all([
    db.rpc("ai_usage_summary", { p_days: days }),
    db.from("feature_flags").select("enabled").eq("key", "ai.assistant").maybeSingle(),
    db.from("platform_settings").select("value").eq("key", "ai.daily_request_cap").maybeSingle(),
  ]);
  const { features, orgs, total } = splitSummary(summary.data);
  const flagOn = flag.data?.enabled === true;
  const keyOn = aiKeyConfigured();
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">AI usage</h1>
      <Card className="mt-4">
        <p className="text-sm">Assistant switch: <strong>{flagOn ? "on" : "off"}</strong> · Provider key: <strong>{keyOn ? "configured" : "not configured"}</strong> · Daily cap: <strong>{cap.data ? String(cap.data.value) : "none"}</strong></p>
        <p className="mt-1 text-sm">Change the switch, the daily cap and the per-plan monthly allowance in <Link className="underline" href="/admin/settings">Settings and flags</Link>. Every change is audited.</p>
        {!(flagOn && keyOn) && <p className="mt-1 text-sm">Members see no AI buttons until the switch is on and a key is configured.</p>}
      </Card>
      {summary.error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">{summary.error.code === "42501" ? "Verify your second factor to see AI usage." : "AI usage could not be loaded. Please try again."}</p>}
      <p className="mt-6 flex gap-3 text-sm">
        {[7, 30, 90].map((d) => (d === days ? <strong key={d}>Last {d} days</strong> : <Link key={d} className="underline" href={`/admin/ai?days=${d}`}>Last {d} days</Link>))}
      </p>
      <p className="mt-3 text-sm">Total: {n(total.calls)} successful requests, {n(total.errors)} failed, {n(total.tokensIn)} input and {n(total.tokensOut)} output tokens. No prompts or answers are stored.</p>
      <h2 className="mt-6 text-lg font-semibold">By feature</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {features.map((r) => <li key={r.label}>{r.label}: {n(r.calls)} ok, {n(r.errors)} failed · {n(r.tokens_in)} in / {n(r.tokens_out)} out</li>)}
        {!summary.error && features.length === 0 && <li>No usage in this period.</li>}
      </ul>
      <h2 className="mt-6 text-lg font-semibold">By organization</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {orgs.map((r, i) => <li key={`${r.label}-${i}`}>{r.label}: {n(r.calls)} ok, {n(r.errors)} failed · {n(r.tokens_in)} in / {n(r.tokens_out)} out</li>)}
        {!summary.error && orgs.length === 0 && <li>No usage in this period.</li>}
      </ul>
    </AppShell>
  );
}
