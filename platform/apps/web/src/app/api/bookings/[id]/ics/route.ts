import { authorizeApi } from "@/lib/auth-context";
import { buildIcs } from "@/lib/bookings/ics";
import { isValidUuid } from "@/lib/marketplace/validators";
import { throttle } from "@/lib/server";
import { createServerSupabase } from "@/lib/supabase/server";

interface Row { id: string; service_title: string; other_org_name: string; starts_at: string; ends_at: string; status: string; meeting_url: string | null }

/** Calendar file for a confirmed booking, for members of either organization on it (read through booking_list, which checks membership). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = new URL(req.url).searchParams.get("org") ?? "";
  if (!isValidUuid(id) || !isValidUuid(org)) return Response.json({ error: "not found" }, { status: 404 });
  const auth = await authorizeApi("org.read", org);
  if (auth instanceof Response) return auth;
  if (!(await throttle("bookings", `user:${auth.userId}`))) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  const db = await createServerSupabase();
  const { data, error } = await db.rpc("booking_list", { p_org: org });
  const b = error ? undefined : ((data ?? []) as Row[]).find((r) => r.id === id);
  if (!b || b.status !== "confirmed") return Response.json({ error: "not found" }, { status: 404 });
  const ics = buildIcs({
    uid: `${b.id}@papple`, start: new Date(b.starts_at), end: new Date(b.ends_at), now: new Date(),
    title: `${b.service_title} with ${b.other_org_name}`, description: b.meeting_url ? `Meeting link: ${b.meeting_url}` : "Booked on Papple", url: b.meeting_url,
  });
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="booking.ics"', "Cache-Control": "no-store" } });
}
