export { LEGAL_PAGES } from "./legal-content";

/** One switch for the whole legal section. Flip `reviewed` only after a lawyer has approved the text and every `null` below is filled. */
export const LEGAL = {
  reviewed: false,
  version: "0.1-draft",
  updated: "2026-10-03",
  address: null as string | null,
  licence: null as string | null,
  governingLaw: null as string | null,
  contactEmail: null as string | null,
  securityContact: null as string | null,
};

export const PLACEHOLDER = "[to be confirmed by Papple World FZE LLC]";
export const show = (v: string | null): string => (v === null || v.trim() === "" ? PLACEHOLDER : v);

export const LEGAL_SLUGS = ["terms", "privacy", "cookies", "marketplace-rules"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
