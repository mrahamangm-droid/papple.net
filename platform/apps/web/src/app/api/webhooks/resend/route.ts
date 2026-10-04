import { handleResendWebhook } from "@/lib/server";

/** Resend calls this directly: no session, no CSRF, authenticity comes only from the Svix signature over the raw body. */
export async function POST(request: Request) {
  const raw = await request.text();
  const { status } = await handleResendWebhook(raw, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  return new Response(null, { status });
}
