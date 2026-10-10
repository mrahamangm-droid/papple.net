import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Lightweight request-level proxy (Next 16 renamed middleware.ts to proxy.ts;
// it now runs on the Node.js runtime). Security headers are also set globally
// in next.config.mjs (headers()); this layer is reserved for
// request-shape checks and auth gating that don't belong in next.config or
// in every individual page/route, and is kept deliberately minimal so it
// doesn't add latency to every request.
//
// Note: the auth-gated paths below (/account, /workspace, /assistant,
// /enterprise, /admin) don't exist yet in this build — this proxy is
// forward-compatible scaffolding for when they're built, and is a no-op
// until then since nothing currently routes to those paths.
const ADMIN_PATHS = ["/admin"];
const AUTH_REQUIRED_PATHS = ["/account", "/workspace", "/assistant", "/enterprise"];
const AUTH_EXEMPT_PATHS = ["/enterprise/accept-invite"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
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
