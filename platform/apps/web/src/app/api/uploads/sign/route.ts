import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorizeApi } from "@/lib/auth-context";
import { validateUploadMeta } from "@/lib/file-validation";
import { storage } from "@/lib/r2";
import { throttle } from "@/lib/server";
import { objectKey } from "@/lib/storage";

const body = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  declaredMime: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const auth = await authorizeApi("files.write", parsed.data.orgId);
  if (auth instanceof Response) return auth;
  if (!(await throttle("uploads", `user:${auth.userId}`))) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });

  const check = validateUploadMeta(parsed.data);
  if (!check.ok) return Response.json({ error: check.reason }, { status: 422 });

  const fileId = randomUUID();
  const key = objectKey(parsed.data.orgId, fileId, check.ext);
  const url = await storage.signUploadUrl(key, check.mime, parsed.data.size);
  return Response.json({ url, key, fileId, headers: { "Content-Type": check.mime } });
}
