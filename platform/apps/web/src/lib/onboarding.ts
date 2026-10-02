import { z } from "zod";

export const PERSONAS = ["client", "professional", "agency", "enterprise", "pgan_expert"] as const;
export type Persona = (typeof PERSONAS)[number];
export type OrgType = "individual" | "agency" | "client_company" | "enterprise";

export const onboardingSchema = z.object({
  persona: z.enum(PERSONAS),
  orgName: z.string().trim().min(2).max(120),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

const ORG_TYPE: Record<Persona, OrgType> = {
  client: "client_company",
  professional: "individual",
  agency: "agency",
  enterprise: "enterprise",
  pgan_expert: "individual",
};

export interface OnboardingDeps {
  getProfile: (userId: string) => Promise<{ persona: Persona | string | null; status: string } | null>;
  findOwnedOrg: (userId: string) => Promise<string | null>;
  createOrganization: (name: string, type: OrgType) => Promise<string>;
  setProfile: (userId: string, p: { persona: Persona; status: "active" | "pending_verification" | "suspended" }) => Promise<void>;
}

/** Persona drives onboarding and navigation only; it never grants permissions (memberships do). */
export function createOnboarding(deps: OnboardingDeps) {
  async function completeOnboarding(userId: string, input: OnboardingInput): Promise<{ orgId: string }> {
    const [existing, profile] = await Promise.all([deps.findOwnedOrg(userId), deps.getProfile(userId)]);
    const orgId = existing ?? (await deps.createOrganization(input.orgName, ORG_TYPE[input.persona]));
    // A profile that already has a persona is never rewritten: re-running onboarding must not reset a verified
    // expert to pending or lift a suspension. Only a missing persona (first run / interrupted run) is filled in.
    if (!profile || profile.persona === null) {
      const status = profile?.status === "suspended" ? "suspended" : input.persona === "pgan_expert" ? "pending_verification" : "active";
      await deps.setProfile(userId, { persona: input.persona, status });
    }
    return { orgId };
  }
  return { completeOnboarding };
}
