import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parsePublicEnv } from "../env";
import { hasAuthCookie } from "./auth-cookie";

/** Refreshes the auth cookies for a request and returns the verified user (if any). */
export async function updateSession(request: NextRequest) {
  const env = parsePublicEnv(process.env);
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // No auth cookie: the visitor is anonymous, so skip the network call to Supabase Auth entirely.
  if (!hasAuthCookie(request.cookies.getAll().map((c) => c.name))) return { response, user: null };
  const { data } = await supabase.auth.getUser();
  return { response, user: data.user };
}
