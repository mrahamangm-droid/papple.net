import { timingSafeEqual } from "node:crypto";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bearer-protected job endpoint. Off (503) until a secret is configured; failures never leak details. */
export function createCronHandler(deps: { secret: () => string | undefined; run: () => Promise<{ sent: number }> }) {
  return async function GET(req: Request): Promise<Response> {
    const secret = deps.secret();
    if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
    const header = req.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ") || !sameSecret(header.slice(7), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    try {
      const { sent } = await deps.run();
      return Response.json({ sent });
    } catch {
      return Response.json({ error: "failed" }, { status: 500 });
    }
  };
}
