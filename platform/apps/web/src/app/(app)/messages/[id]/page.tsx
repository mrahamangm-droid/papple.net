import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { MessageList, type MessageRow } from "@/components/marketplace/MessageList";
import { ReplyForm } from "@/components/marketplace/ReplyForm";
import { requireCapability } from "@/lib/auth-context";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function Thread({ params }: PageProps<"/messages/[id]">) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const ctx = await requireCapability("org.read");
  const db = await createServerSupabase();
  const { data: conv } = await db.from("conversations").select("id, kind").eq("id", id).maybeSingle();
  if (!conv) notFound(); // RLS: only participant organizations can see a conversation
  const [{ data: parts }, { data: msgs }] = await Promise.all([
    db.from("conversation_participants").select("org_id").eq("conversation_id", id),
    db.from("messages").select("id, sender_user_id, sender_org_id, body, created_at").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500),
  ]);
  const mine = new Set(ctx.memberships.map((m) => m.orgId));
  const myOrg = (parts ?? []).map((x) => x.org_id as string).find((o) => mine.has(o) && ctx.memberships.find((m) => m.orgId === o)?.role !== "viewer");
  const rows: MessageRow[] = (msgs ?? []).map((m) => ({
    id: m.id as string, mine: m.sender_user_id === ctx.userId, senderName: "Other party", body: m.body as string, createdAt: m.created_at as string,
  }));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Conversation</h1>
      <div className="mt-6"><MessageList messages={rows} /></div>
      <div className="mt-6 max-w-xl">
        {myOrg ? <ReplyForm conversationId={id} orgId={myOrg} /> : <p className="text-sm">Your role cannot post in this conversation.</p>}
      </div>
    </AppShell>
  );
}
