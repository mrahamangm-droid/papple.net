import { crmUnsubscribe } from "@/lib/server";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const token = (request: Request) => new URL(request.url).searchParams.get("t");

/** Confirmation page only; opening the link never unsubscribes anyone. */
export async function GET(request: Request) {
  const r = await (await crmUnsubscribe()).get(token(request));
  return new Response(r.html, { status: r.status, headers });
}

/** The confirmation form and mail clients' one-click unsubscribe (RFC 8058) both post here. */
export async function POST(request: Request) {
  const r = await (await crmUnsubscribe()).post(token(request));
  return new Response(r.html, { status: r.status, headers });
}
