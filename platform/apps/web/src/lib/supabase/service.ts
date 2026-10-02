import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseServerEnv } from "../env";

/** Server-only client using the service role. Bypasses RLS: use only behind adminAction or trusted server code. */
export function createServiceClient(): SupabaseClient {
  const env = parseServerEnv(process.env);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
