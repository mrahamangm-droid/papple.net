import { describe, expect, it, vi } from "vitest";
import { createOnboarding, onboardingSchema } from "./onboarding";

describe("onboardingSchema", () => {
  it("rejects privileged personas such as admin", () => {
    expect(onboardingSchema.safeParse({ persona: "admin", orgName: "Acme" }).success).toBe(false);
  });
  it("trims the org name and enforces 2..120 chars", () => {
    expect(onboardingSchema.parse({ persona: "client", orgName: "  Acme  " }).orgName).toBe("Acme");
    expect(onboardingSchema.safeParse({ persona: "client", orgName: " a " }).success).toBe(false);
    expect(onboardingSchema.safeParse({ persona: "client", orgName: "x".repeat(121) }).success).toBe(false);
  });
});

function deps(existing: string | null = null, profile: { persona: string | null; status: string } | null = null) {
  return {
    getProfile: vi.fn(async (_u: string) => profile),
    findOwnedOrg: vi.fn(async (_u: string) => existing),
    createOrganization: vi.fn(async (_n: string, _t: string) => "org-new"),
    setProfile: vi.fn(async (_u: string, _p: { persona: string; status: string }) => {}),
  };
}

describe("completeOnboarding", () => {
  it("creates one org of the mapped type and sets persona with active status", async () => {
    const d = deps();
    const { completeOnboarding } = createOnboarding(d);
    await expect(completeOnboarding("u1", { persona: "agency", orgName: "Studio" })).resolves.toEqual({ orgId: "org-new" });
    expect(d.createOrganization).toHaveBeenCalledWith("Studio", "agency");
    expect(d.setProfile).toHaveBeenCalledWith("u1", { persona: "agency", status: "active" });
  });
  it("maps personas to org types", async () => {
    const cases: Array<[string, string]> = [["client", "client_company"], ["professional", "individual"], ["enterprise", "enterprise"], ["pgan_expert", "individual"]];
    for (const [persona, type] of cases) {
      const d = deps();
      await createOnboarding(d).completeOnboarding("u1", { persona: persona as never, orgName: "Name" });
      expect(d.createOrganization).toHaveBeenCalledWith("Name", type);
    }
  });
  it("marks pgan_expert profiles pending_verification (persona grants no permission)", async () => {
    const d = deps();
    await createOnboarding(d).completeOnboarding("u1", { persona: "pgan_expert", orgName: "Expert" });
    expect(d.setProfile).toHaveBeenCalledWith("u1", { persona: "pgan_expert", status: "pending_verification" });
  });
  it("is idempotent: a retry reuses the existing org and creates none", async () => {
    const d = deps("org-existing");
    await expect(createOnboarding(d).completeOnboarding("u1", { persona: "client", orgName: "Acme" })).resolves.toEqual({ orgId: "org-existing" });
    expect(d.createOrganization).not.toHaveBeenCalled();
  });
});

describe("completeOnboarding never overrides account standing", () => {
  it("keeps a suspended profile suspended when onboarding is re-run", async () => {
    const d = deps(null, { persona: null, status: "suspended" });
    await createOnboarding(d).completeOnboarding("u1", { persona: "client", orgName: "Acme" });
    expect(d.setProfile).toHaveBeenCalledWith("u1", { persona: "client", status: "suspended" });
  });
  it("does not touch a profile that already has a persona (a verified expert is not reset to pending)", async () => {
    const d = deps("org-existing", { persona: "pgan_expert", status: "active" });
    await createOnboarding(d).completeOnboarding("u1", { persona: "pgan_expert", orgName: "Expert" });
    expect(d.setProfile).not.toHaveBeenCalled();
  });
  it("finishes a half-completed onboarding: org exists but persona was never saved", async () => {
    const d = deps("org-existing", { persona: null, status: "active" });
    await createOnboarding(d).completeOnboarding("u1", { persona: "client", orgName: "Acme" });
    expect(d.setProfile).toHaveBeenCalledWith("u1", { persona: "client", status: "active" });
    expect(d.createOrganization).not.toHaveBeenCalled();
  });
});
