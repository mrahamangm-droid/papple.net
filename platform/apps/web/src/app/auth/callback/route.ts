import { NextResponse, type NextRequest } from "next/server";
import { parsePublicEnv } from "@/lib/env";
import { safeRedirect } from "@/lib/safe-redirect";
import { createServerSupabase } from "@/lib/supabase/server";

/** Completes email verification / password-reset / OAuth code exchange, then redirects safely. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = parsePublicEnv(process.env).NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin; // never trust a proxied Host blindly
  const code = searchParams.get("code");
  const target = safeRedirect(searchParams.get("next"));
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(target, origin));
  }
  return NextResponse.redirect(new URL("/signin?error=" + encodeURIComponent("That link is invalid or has expired."), origin));
}
