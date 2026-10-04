"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { createContractActions } from "@/lib/contracts/actions";
import { contractsDb, paymentProvider, paymentsServiceDb, settings, throttle } from "@/lib/server";

const actions = createContractActions({
  db: contractsDb,
  // Lazy on purpose: payments need Stripe keys, and importing this file must not.
  service: {
    paymentDestination: (id) => paymentsServiceDb().paymentDestination(id),
    attachCheckoutSession: (id, session, prev) => paymentsServiceDb().attachCheckoutSession(id, session, prev),
    payoutAccount: (orgId) => paymentsServiceDb().payoutAccount(orgId),
    registerConnectedAccount: (orgId, account) => paymentsServiceDb().registerConnectedAccount(orgId, account),
  },
  provider: {
    createCheckout: (i) => paymentProvider().createCheckout(i),
    expireCheckout: (id) => paymentProvider().expireCheckout(id),
    createOnboardingLink: (i) => paymentProvider().createOnboardingLink(i),
  },
  auth: async () => {
    const ctx = await getAuthContext();
    return ctx ? { userId: ctx.userId } : null;
  },
  throttle,
  revalidate: (p) => revalidatePath(p),
  appUrl: () => {
    const url = process.env.NEXT_PUBLIC_SITE_URL;
    if (!url) throw new Error("NEXT_PUBLIC_SITE_URL is not set");
    return url;
  },
  expiryMinutes: () => settings.getSetting("payments.checkout_expiry_minutes", z.number().int().min(30).max(1440)),
});

// "use server" files may only export async functions, so each action is wrapped individually.
export async function hireAction(input: unknown) { return actions.hire(input); }
export async function setMilestonesAction(input: unknown) { return actions.setMilestones(input); }
export async function acceptContractAction(input: unknown) { return actions.acceptContract(input); }
export async function activateContractAction(input: unknown) { return actions.activateContract(input); }
export async function cancelContractAction(input: unknown) { return actions.cancelContract(input); }
export async function submitMilestoneAction(input: unknown) { return actions.submitMilestone(input); }
export async function requestChangesAction(input: unknown) { return actions.requestChanges(input); }
export async function raiseDisputeAction(input: unknown) { return actions.raiseDispute(input); }
export async function postReviewAction(input: unknown) { return actions.postReview(input); }
export async function approveAndPayAction(input: unknown) { return actions.approveAndPay(input); }
export async function startPayoutOnboardingAction(input: unknown) { return actions.startPayoutOnboarding(input); }
