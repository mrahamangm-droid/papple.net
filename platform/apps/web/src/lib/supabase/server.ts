import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parsePublicEnv } from "../env";

export async function createServerSupabase() {
  const env = parsePublicEnv(process.env);
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component; the proxy refreshes the session */
        }
      },
    },
  });
}

/** Verifies the session with Supabase Auth (never trust an unverified cookie/JWT). */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}
