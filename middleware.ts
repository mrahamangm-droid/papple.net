import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Lightweight request-level middleware. Security headers are also set
// globally in next.config.mjs (headers()); this layer is reserved for
// request-shape checks and auth gating that don't belong in next.config or
// in every individual page/route, and is kept deliberately minimal so it
// doesn't add latency to every request.
//
// Build 4 note: every gated page/route ALSO checks the session itself
// (getCurrentUser()/role in src/lib/session.ts) — this middleware is
// defense in depth, not the only check, so a route is still safe even if a
// matcher below is ever misconfigured.
const ADMIN_PATHS = ["/admin"];
const AUTH_REQUIRED_PATHS = ["/account", "/workspace", "/assistant", "/enterprise"];
// This page handles both signed-in and signed-out visitors itself (it shows
// sign-in/sign-up links to someone who isn't authenticated yet, matched by
// the invite's own email) — gating it here would bounce a signed-out
// invitee before they ever see what the link is for.
const AUTH_EXEMPT_PATHS = ["/enterprise/accept-invite"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    // Defense in depth: reject obviously oversized bodies early for API
    // routes before they reach route handlers (routes still validate with zod).
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > 100_000) {
      return NextResponse.json({ error: "Request too large." }, { status: 413 });
    }
    return NextResponse.next();
  }

  if (AUTH_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const needsAuth = AUTH_REQUIRED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const needsAdmin = ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (needsAuth || needsAdmin) {
    const token = await getToken({ req: request, secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET });
    if (!token) {
      const signInUrl = new URL("/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
      return NextResponse.redirect(signInUrl);
    }
    if (needsAdmin && token.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/account", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/account/:path*", "/workspace/:path*", "/assistant/:path*", "/enterprise/:path*", "/admin/:path*"],
};
