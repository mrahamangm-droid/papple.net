"use server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { createAdminConsoleActions } from "@/lib/admin/actions";
import { adminConsoleDb } from "@/lib/server";

const actions = createAdminConsoleActions({ db: adminConsoleDb, revalidate: (p) => revalidatePath(p), hasSecondFactor: async () => false });

/** Professional action: the database checks the caller owns or administers the organization. */
export async function requestVerificationAction(input: unknown) {
  if (!(await getAuthContext())) return { ok: false as const, code: "forbidden" as const };
  return actions.requestVerification(input);
}
