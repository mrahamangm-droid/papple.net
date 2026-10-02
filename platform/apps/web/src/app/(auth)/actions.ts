"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parsePublicEnv } from "@/lib/env";
import { createServerSupabase, getSessionUser } from "@/lib/supabase/server";
import { clientIp, completeOnboardingForUser, throttle } from "@/lib/server";
import { onboardingSchema } from "@/lib/onboarding";
import { safeRedirect } from "@/lib/safe-redirect";

const email = z.string().trim().toLowerCase().email().max(254);
const signUpSchema = z.object({ email, password: z.string().min(12, "Use at least 12 characters").max(128) });
const signInSchema = z.object({ email, password: z.string().min(1).max(128), next: z.string().optional() });

const back = (path: string, error: string): never => redirect(`${path}?error=${encodeURIComponent(error)}`);
const TOO_MANY = "Too many attempts. Please wait a minute and try again.";
const siteUrl = () => parsePublicEnv(process.env).NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function signUpAction(formData: FormData) {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/signup", parsed.error.issues[0]?.message ?? "Invalid details");
  if (!(await throttle("auth", `signup:${await clientIp()}`))) back("/signup", TOO_MANY);
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({
    email: parsed.data!.email,
    password: parsed.data!.password,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback` },
  });
  // Generic outcome either way: do not reveal whether the address already exists.
  if (error && error.status !== 422) back("/signup", "Could not create the account. Try again.");
  redirect("/signin?notice=check-email");
}

export async function signInAction(formData: FormData) {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/signin", "Invalid email or password.");
  if (!(await throttle("auth", `signin:${await clientIp()}:${parsed.data!.email}`))) back("/signin", TOO_MANY);
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data!.email, password: parsed.data!.password });
  if (error) back("/signin", "Invalid email or password.");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/mfa");
  redirect(safeRedirect(String(formData.get("next") ?? "")));
}

export async function resetAction(formData: FormData) {
  const parsed = z.object({ email }).safeParse(Object.fromEntries(formData));
  if (parsed.success) {
    if (!(await throttle("auth", `reset:${await clientIp()}:${parsed.data.email}`))) back("/reset", TOO_MANY);
    const supabase = await createServerSupabase();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${siteUrl()}/auth/callback` });
  }
  redirect("/signin?notice=reset-sent"); // same response whether or not the account exists
}

export async function signOutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/signin");
}

export async function onboardAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/onboarding", "Choose an account type and enter a name (2–120 characters).");
  if (!(await throttle("onboarding", `user:${user!.id}`))) back("/onboarding", TOO_MANY);
  await completeOnboardingForUser(user!.id, parsed.data!);
  redirect("/dashboard");
}
