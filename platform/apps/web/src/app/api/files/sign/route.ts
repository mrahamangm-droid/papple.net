import { authorizeApi } from "@/lib/auth-context";
import { storage } from "@/lib/r2";
import { orgIdFromKey } from "@/lib/storage";

/** Returns a 5-minute signed download URL, only for members of the org that owns the object. */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const orgId = orgIdFromKey(key);
  if (!orgId) return Response.json({ error: "invalid key" }, { status: 400 });
  const auth = await authorizeApi("org.read", orgId);
  if (auth instanceof Response) return auth;
  return Response.json({ url: await storage.signDownloadUrl(key) }, { headers: { "Cache-Control": "no-store" } });
}
