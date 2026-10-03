import { z } from "zod";

const reason = z.string().trim().min(10).max(1000);
const slug = z.string().regex(/^[a-z0-9-]{2,60}$/);
const name = z.string().trim().min(2).max(80);

export const KIND_LABEL: Record<string, string> = { profile: "Profile", service: "Service", project: "Project", message: "Message" };
/** Messages can be reported and dismissed but are not hideable. */
export const canHide = (kind: string) => kind === "profile" || kind === "service" || kind === "project";

export const hideInput = z.object({ kind: z.enum(["profile", "service", "project"]), id: z.uuid(), hidden: z.boolean(), reason });
export const dismissInput = z.object({ reportId: z.uuid(), reason });
export const categoryInput = z.object({
  id: z.uuid().nullable(), slug: slug.optional(), name, parentId: z.uuid().nullable(),
  position: z.number().int().min(0).max(10000), active: z.boolean(), reason,
});
export const skillInput = z.object({ id: z.uuid().nullable(), slug: slug.optional(), name, categoryId: z.uuid().nullable(), active: z.boolean(), reason });
