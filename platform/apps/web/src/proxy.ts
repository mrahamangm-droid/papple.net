import { NextResponse, type NextRequest } from "next/server";
import { parsePublicEnv } from "@/lib/env";
import { connectSources } from "@/lib/observability";
import { buildSecurityHeaders } from "@/lib/security-headers";
import { updateSession } from "@/lib/supabase/session";

// Optimistic gate only. Every protected page/route re-checks on the server (defense in depth).
const PROTECTED = ["/dashboard", "/admin", "/onboarding", "/settings"];

function applyHeaders(res: NextResponse, headers: Record<string, string>) {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const pub = parsePublicEnv(process.env);
  const headers = buildSecurityHeaders(nonce, {
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: pub.NEXT_PUBLIC_SUPABASE_URL,
    extraConnectSrc: connectSources({ SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_POSTHOG_KEY: pub.NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST }),
  });
  // Next reads the nonce from the request's CSP header and stamps its own scripts with it.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", headers["Content-Security-Policy"]!);

  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    url.searchParams.set("next", path);
    return applyHeaders(NextResponse.redirect(url), headers);
  }
  return applyHeaders(response, headers);
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
