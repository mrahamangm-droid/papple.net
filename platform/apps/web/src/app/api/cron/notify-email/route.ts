import { createCronHandler } from "@/lib/marketplace/cron-handler";
import { runEmailNotifier } from "@/lib/server";

export const GET = createCronHandler({ secret: () => process.env.CRON_SECRET, run: runEmailNotifier });
