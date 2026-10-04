import { mapDbError } from "./errors";
import type { z } from "zod";
import type { messageInput, profileInput, projectInput, proposalInput, reportInput, serviceInput } from "./validators";

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Thin typed wrappers over the marketplace RPCs. Every call names its organization explicitly; the database re-checks membership. */
export function createMarketplaceDb(rpc: Rpc) {
  async function call<T = string>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await rpc(fn, args);
    if (error) throw mapDbError(error);
    return data as T;
  }
  return {
    upsertProfile: (i: z.output<typeof profileInput>) => call("upsert_provider_profile", {
      p_org: i.orgId, p_headline: i.headline, p_summary: i.summary, p_country: i.country ?? null, p_languages: i.languages,
      p_hourly_min: i.hourlyMin ?? null, p_hourly_max: i.hourlyMax ?? null, p_currency: i.currency,
      p_availability: i.availability, p_visibility: i.visibility, p_skill_ids: i.skillIds,
    }),
    upsertService: (i: z.output<typeof serviceInput>) => call("upsert_service", {
      p_org: i.orgId, p_id: i.id ?? null, p_category: i.categoryId ?? null, p_title: i.title, p_description: i.description,
      p_pricing_model: i.pricingModel, p_price_min: i.priceMin ?? null, p_currency: i.currency,
      p_delivery_days: i.deliveryDays ?? null, p_status: i.status,
    }),
    upsertProject: (i: z.output<typeof projectInput>) => call("upsert_project", {
      p_org: i.orgId, p_id: i.id ?? null, p_title: i.title, p_description: i.description, p_category: i.categoryId ?? null,
      p_budget_min: i.budgetMin ?? null, p_budget_max: i.budgetMax ?? null, p_currency: i.currency,
      p_deadline: i.deadline ?? null, p_visibility: i.visibility, p_skill_ids: i.skillIds,
    }),
    setProjectStatus: (i: { orgId: string; id: string; status: string }) =>
      call<void>("set_project_status", { p_org: i.orgId, p_id: i.id, p_status: i.status }),
    submitProposal: (i: z.output<typeof proposalInput>) => call("submit_proposal", {
      p_org: i.orgId, p_project: i.projectId, p_cover_letter: i.coverLetter, p_price: i.price,
      p_currency: i.currency, p_delivery_days: i.deliveryDays,
    }),
    withdrawProposal: (orgId: string, id: string) => call<void>("withdraw_proposal", { p_org: orgId, p_id: id }),
    setProposalStatus: (id: string, status: "shortlisted" | "declined") => call<void>("set_proposal_status", { p_id: id, p_status: status }),
    startConversation: (i: { fromOrgId: string; kind: "service" | "profile" | "project" | "proposal"; refId: string; firstMessage: string }) =>
      call("start_conversation", { p_from_org: i.fromOrgId, p_kind: i.kind, p_ref: i.refId, p_first_message: i.firstMessage }),
    sendMessage: (i: z.output<typeof messageInput>) =>
      call("send_message", { p_conversation: i.conversationId, p_org: i.orgId, p_body: i.body }),
    markNotificationRead: (id: string) => call<void>("mark_notification_read", { p_id: id }),
    report: (i: z.output<typeof reportInput>) => call("report_content", { p_kind: i.kind, p_id: i.id, p_reason: i.reason }),
  };
}
export type MarketplaceDb = ReturnType<typeof createMarketplaceDb>;
