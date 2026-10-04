"use server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { createAdminConsoleActions } from "@/lib/admin/actions";
import { categoryInput, dismissInput, hideInput, skillInput } from "@/lib/admin/moderation";
import { credentialReviewInput, credentialRevokeInput, flagInput, orgStatusInput, planInput, revokeVerificationInput, roleInput, settingInput, verificationReviewInput } from "@/lib/admin/validators";
import { adminAction, adminConsoleDb } from "@/lib/server";

const actions = createAdminConsoleActions({
  db: adminConsoleDb,
  revalidate: (p) => revalidatePath(p),
  hasSecondFactor: async () => (await getAuthContext())?.aal === "aal2",
});

// Platform admin check, input validation and a wrapper audit entry come from adminAction; the database writes its own audit row with the reason.
const setSetting = adminAction({ name: "console.setting.set", input: settingInput, handler: (i) => actions.setSetting(i) });
const setFlag = adminAction({ name: "console.flag.set", input: flagInput, handler: (i) => actions.setFlag(i) });
const updatePlan = adminAction({ name: "console.plan.update", input: planInput, handler: (i) => actions.updatePlan(i) });
const setOrgStatus = adminAction({ name: "console.org.status", input: orgStatusInput, handler: (i) => actions.setOrgStatus(i) });
const setPlatformRole = adminAction({ name: "console.role.set", input: roleInput, handler: (i) => actions.setPlatformRole(i) });
const reviewVerification = adminAction({ name: "console.verification.review", input: verificationReviewInput, handler: (i) => actions.reviewVerification(i) });
const revokeVerification = adminAction({ name: "console.verification.revoke", input: revokeVerificationInput, handler: (i) => actions.revokeVerification(i) });
const reviewCredential = adminAction({ name: "console.credential.review", input: credentialReviewInput, handler: (i) => actions.reviewCredential(i) });
const revokeCredential = adminAction({ name: "console.credential.revoke", input: credentialRevokeInput, handler: (i) => actions.revokeCredential(i) });
const setVisibility = adminAction({ name: "console.visibility.set", input: hideInput, handler: (i) => actions.setVisibility(i) });
const dismissReport = adminAction({ name: "console.report.dismiss", input: dismissInput, handler: (i) => actions.dismissReport(i) });
const saveCategory = adminAction({ name: "console.category.save", input: categoryInput, handler: (i) => actions.saveCategory(i) });
const saveSkill = adminAction({ name: "console.skill.save", input: skillInput, handler: (i) => actions.saveSkill(i) });

export async function setVisibilityAction(input: unknown) { return setVisibility(input); }
export async function dismissReportAction(input: unknown) { return dismissReport(input); }
export async function saveCategoryAction(input: unknown) { return saveCategory(input); }
export async function saveSkillAction(input: unknown) { return saveSkill(input); }
export async function setSettingAction(input: unknown) { return setSetting(input); }
export async function setFlagAction(input: unknown) { return setFlag(input); }
export async function updatePlanAction(input: unknown) { return updatePlan(input); }
export async function setOrgStatusAction(input: unknown) { return setOrgStatus(input); }
export async function setPlatformRoleAction(input: unknown) { return setPlatformRole(input); }
export async function reviewVerificationAction(input: unknown) { return reviewVerification(input); }
export async function revokeVerificationAction(input: unknown) { return revokeVerification(input); }
export async function reviewCredentialAction(input: unknown) { return reviewCredential(input); }
export async function revokeCredentialAction(input: unknown) { return revokeCredential(input); }
