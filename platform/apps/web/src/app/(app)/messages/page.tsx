import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function Messages() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data } = await db.from("conversations").select("id, kind, last_message_at, created_at").order("last_message_at", { ascending: false, nullsFirst: false }).limit(50);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Messages</h1>
      <ul className="mt-6 space-y-2">
        {(data ?? []).map((c) => (
          <li key={c.id} className="text-sm"><Link className="underline" href={`/messages/${c.id}`}>Conversation about a {c.kind}</Link> <span className="opacity-70">· {new Date((c.last_message_at ?? c.created_at) as string).toUTCString()}</span></li>
        ))}
        {(data ?? []).length === 0 && <li className="text-sm">No conversations yet. Message a professional from their profile or a project.</li>}
      </ul>
    </AppShell>
  );
}
