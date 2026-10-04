import { clientIp, searchService, throttle } from "@/lib/server";
import { createSearchHandler } from "@/lib/marketplace/search-handler";

export const GET = createSearchHandler({ search: searchService, throttle, ip: clientIp });
