import { z } from "zod";
import { authorizeApi } from "@/lib/auth-context";
import { verifyDeps } from "@/lib/r2";
import { throttle } from "@/lib/server";
import { orgIdFromKey, verifyUploadedObject } from "@/lib/storage";

const body = z.object({ key: z.string().min(1).max(300), name: z.string().min(1).max(255), declaredMime: z.string().min(1).max(200) });

/** Call after the browser finishes the signed PUT: re-validates stored bytes and deletes bad objects. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const orgId = orgIdFromKey(parsed.data.key);
  if (!orgId) return Response.json({ error: "invalid key" }, { status: 400 });
  const auth = await authorizeApi("files.write", orgId);
  if (auth instanceof Response) return auth;
  if (!(await throttle("uploads", `user:${auth.userId}`))) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });

  const result = await verifyUploadedObject(verifyDeps, parsed.data.key, parsed.data);
  return result.ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: result.reason }, { status: 422 });
}
