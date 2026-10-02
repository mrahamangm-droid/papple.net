import { randomBytes } from "node:crypto";

/** Mirrors the database `make_slug`: lowercase ascii words joined by hyphens, max 60 chars, `p-<8 hex>` when nothing usable remains. */
export function slugify(text: string, randomHex: () => string = () => randomBytes(4).toString("hex")): string {
  let s = (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  s = s.slice(0, 60).replace(/-+$/g, "");
  return s === "" ? `p-${randomHex()}` : s;
}
