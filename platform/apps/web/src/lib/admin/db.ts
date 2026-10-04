import type { Rpc } from "../marketplace/db";
import { mapDbError } from "../marketplace/errors";

/** Everything runs through the signed-in user's own session: the database checks role, second factor and reason. Never the service client. */
export function createAdminConsoleDb(rpc: Rpc) {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await rpc(fn, args);
    if (error) throw mapDbError(error);
  };
  return {
    setSetting: (i: { key: string; value: unknown; reason: string }) => call("admin_set_setting", { p_key: i.key, p_value: i.value, p_reason: i.reason }),
    setFlag: (i: { key: string; enabled: boolean; reason: string }) => call("admin_set_flag", { p_key: i.key, p_enabled: i.enabled, p_reason: i.reason }),
    updatePlan: (i: { key: string; name: string; priceCents: number | null; active: boolean; limits: Record<string, unknown>; features: Record<string, unknown>; reason: string }) =>
      call("admin_update_plan", { p_key: i.key, p_name: i.name, p_price_cents: i.priceCents, p_active: i.active, p_limits: i.limits, p_features: i.features, p_reason: i.reason }),
    setOrgStatus: (i: { orgId: string; status: "active" | "suspended"; reason: string }) => call("admin_set_org_status", { p_org: i.orgId, p_status: i.status, p_reason: i.reason }),
    setPlatformRole: (i: { userId: string; role: "admin" | "support"; grant: boolean; reason: string }) =>
      call("admin_set_platform_role", { p_user: i.userId, p_role: i.role, p_grant: i.grant, p_reason: i.reason }),
    requestVerification: (i: { orgId: string; note: string; url?: string }) => call("request_verification", { p_org: i.orgId, p_note: i.note, p_url: i.url || null }),
    reviewVerification: (i: { requestId: string; decision: "approved" | "rejected"; note: string }) =>
      call("review_verification", { p_request: i.requestId, p_decision: i.decision, p_note: i.note }),
    reviewCredential: (i: { credentialId: string; version: number; decision: "approved" | "rejected"; note: string }) =>
      call("credential_review", { p_id: i.credentialId, p_version: i.version, p_decision: i.decision, p_note: i.note }),
    revokeCredential: (i: { credentialId: string; reason: string }) => call("credential_revoke", { p_id: i.credentialId, p_reason: i.reason }),
    setVisibility: (i: { kind: "profile" | "service" | "project"; id: string; hidden: boolean; reason: string }) =>
      call("admin_set_visibility", { p_kind: i.kind, p_id: i.id, p_hidden: i.hidden, p_reason: i.reason }),
    dismissReport: (i: { reportId: string; reason: string }) => call("dismiss_report", { p_report: i.reportId, p_reason: i.reason }),
    saveCategory: (i: { id: string | null; slug?: string; name: string; parentId: string | null; position: number; active: boolean; reason: string }) =>
      call("admin_save_category", { p_id: i.id, p_slug: i.slug ?? null, p_name: i.name, p_parent: i.parentId, p_position: i.position, p_active: i.active, p_reason: i.reason }),
    saveSkill: (i: { id: string | null; slug?: string; name: string; categoryId: string | null; active: boolean; reason: string }) =>
      call("admin_save_skill", { p_id: i.id, p_slug: i.slug ?? null, p_name: i.name, p_category: i.categoryId, p_active: i.active, p_reason: i.reason }),
    revokeVerification: (i: { orgId: string; reason: string }) => call("revoke_verification", { p_org: i.orgId, p_reason: i.reason }),
  };
}
export type AdminConsoleDb = ReturnType<typeof createAdminConsoleDb>;
