import { workService } from "@/lib/server";

/** Download: the database says whether this user may read the file, then we redirect to a five-minute signed URL. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await workService(() => {}).authorizeDownload({ id });
  const headers = { "Cache-Control": "no-store" };
  if (r.ok) return new Response(null, { status: 302, headers: { ...headers, Location: r.url } });
  const status = r.code === "forbidden" ? 403 : r.code === "invalid" ? 404 : r.code === "rate" ? 429 : 500;
  return Response.json({ error: "not available" }, { status, headers });
}
