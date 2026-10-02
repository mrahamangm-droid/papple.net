import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
  });
}
