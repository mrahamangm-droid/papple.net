import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { MarkReadButton } from "@/components/marketplace/MarkReadButton";
import { requireCapability } from "@/lib/auth-context";
import { approvalNotificationCopy } from "@/lib/approvals/present";
import { bookingNotificationCopy } from "@/lib/bookings/present";
import { notificationCopy } from "@/lib/contracts/present";
import { inviteNotificationCopy } from "@/lib/talent/present";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const TEXT: Record<string, string> = {
  proposal_received: "You received a new proposal.",
  proposal_status: "A proposal you sent has a new status.",
  message_received: "You have a new message.",
  project_closed: "A project you proposed on was closed.",
};

export default async function Notifications() {
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data } = await db.from("notifications").select("id, type, payload, read_at, created_at").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(50);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <ul className="mt-6 space-y-3">
        {(data ?? []).map((n) => {
          const payload = (n.payload ?? {}) as { project_id?: string; conversation_id?: string; contract_id?: string };
          const contract = notificationCopy(n.type as string, payload) ?? inviteNotificationCopy(n.type as string, (n.payload ?? {}) as Record<string, unknown>)
            ?? approvalNotificationCopy(n.type as string, (n.payload ?? {}) as Record<string, unknown>)
            ?? bookingNotificationCopy(n.type as string, (n.payload ?? {}) as Record<string, unknown>);
          const href = contract ? contract.href : payload.conversation_id ? `/messages/${payload.conversation_id}` : payload.project_id ? `/projects/${payload.project_id}` : null;
          return (
            <li key={n.id} className={`text-sm ${n.read_at ? "opacity-60" : ""}`}>
              {contract?.text ?? TEXT[n.type as string] ?? "You have a new notification."} {href && <Link className="underline" href={href}>Open</Link>} {!n.read_at && <MarkReadButton id={n.id as string} />}
            </li>
          );
        })}
        {(data ?? []).length === 0 && <li className="text-sm">You are all caught up.</li>}
      </ul>
    </AppShell>
  );
}
