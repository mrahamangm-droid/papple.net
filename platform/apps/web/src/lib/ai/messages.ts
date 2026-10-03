import type { AiResult } from "./service";

const COPY = {
  forbidden: "The AI assistant is not available for this account or organization.",
  invalid: "That could not be processed. Check the text and try again.",
  limit: "Your AI allowance for this period is used up. It resets monthly, or you can review your plan.",
  rate: "You are using the assistant too quickly. Please wait a minute and try again.",
  unavailable: "The AI assistant is temporarily unavailable. Please try again later or write it yourself.",
  error: "The assistant could not produce a usable suggestion. Please try again.",
} as const;

/** Calm copy for an AI result; empty on success. Never echoes provider or server text. */
export function aiMessageFor(r: AiResult): string {
  return r.ok ? "" : COPY[r.code];
}
