import { handleStripeWebhook } from "@/lib/server";

/** Stripe calls this directly: no session, no CSRF, authenticity comes only from the signature over the raw body. */
export async function POST(request: Request) {
  const raw = await request.text();
  const { status } = await handleStripeWebhook(raw, request.headers.get("stripe-signature"));
  return new Response(null, { status });
}
