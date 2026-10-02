import type { ActionResult } from "./actions";

const COPY = {
  forbidden: "You are not allowed to do that. Check that you are signed in and acting for the right organization.",
  invalid: "Some of the information is missing or not valid. Please review the form and try again.",
  limit: "You have reached a usage limit for your plan. Try again later or review your plan.",
  duplicate: "That already exists. Open the existing item instead.",
  rate: "You are doing that too quickly. Please wait a minute and try again.",
  error: "Something went wrong on our side. Please try again shortly.",
} as const;

/** Calm user-facing copy for an action result; empty on success. Never echoes server text. */
export function messageFor(r: ActionResult): string {
  return r.ok ? "" : COPY[r.code];
}
