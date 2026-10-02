import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability";

export function register() {
  if (!process.env.SENTRY_DSN) return; // monitoring is opt-in per environment
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
  });
}

export const onRequestError = Sentry.captureRequestError;
