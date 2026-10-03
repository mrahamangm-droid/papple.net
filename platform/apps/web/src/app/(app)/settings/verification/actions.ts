"use server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { createAdminConsoleActions } from "@/lib/admin/actions";
import { adminConsoleDb, throttle } from "@/lib/server";

/** Professional action: the database checks the caller owns or administers the organization. */
export async function requestVerificationAction(input: unknown) {
  const auth = await getAuthContext();
  if (!auth) return { ok: false as const, code: "forbidden" as const };
  return createAdminConsoleActions({ db: adminConsoleDb, revalidate: (p) => revalidatePath(p), hasSecondFactor: async () => false, throttleUser: () => throttle("verification", `user:${auth.userId}`) }).requestVerification(input);
}
