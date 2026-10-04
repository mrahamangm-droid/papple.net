import { apiV1 } from "@/lib/server";

/** Read-only, bearer-key API. No session and no cookies: the key resolves to one organization and nothing else. */
export const dynamic = "force-dynamic";
export const GET = (request: Request) => apiV1().handle("projects", request);
