import type { ZodType } from "zod";
import { InvalidInputError, NotAllowedError } from "../marketplace/errors";
import type { AdminConsoleDb } from "./db";
import { categoryInput, dismissInput, hideInput, skillInput } from "./moderation";
import { flagInput, orgStatusInput, planInput, revokeVerificationInput, roleInput, settingInput, verificationRequestInput, verificationReviewInput } from "./validators";

export type ConsoleResult = { ok: true } | { ok: false; code: "forbidden" | "invalid" | "error" | "rate" };

interface Deps {
  db: AdminConsoleDb;
  revalidate: (path: string) => void;
  /** The admin's session is at aal2. The database checks it too; this keeps a request without it from reaching the database at all. */
  hasSecondFactor: () => Promise<boolean>;
  /** Per-user rate limit for actions open to ordinary users. Returns false when the caller is over the limit. */
  throttleUser?: () => Promise<boolean>;
}

/** Admin-only wrapping (admin check + audit) happens where these are exposed (adminAction). Expected failures return codes and never throw. */
export function createAdminConsoleActions(deps: Deps) {
  const fail = (e: unknown): ConsoleResult => {
    if (e instanceof NotAllowedError) return { ok: false, code: "forbidden" };
    if (e instanceof InvalidInputError) return { ok: false, code: "invalid" };
    return { ok: false, code: "error" };
  };
  async function run<T>(raw: unknown, schema: ZodType<T>, needsAal2: boolean, paths: string[], exec: (v: T) => Promise<void>): Promise<ConsoleResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "invalid" };
    if (needsAal2 && !(await deps.hasSecondFactor())) return { ok: false, code: "forbidden" };
    try {
      await exec(parsed.data);
    } catch (e) {
      return fail(e);
    }
    for (const p of paths) deps.revalidate(p);
    return { ok: true };
  }
  return {
    setSetting: (raw: unknown) => run(raw, settingInput as unknown as ZodType<{ key: string; value: unknown; reason: string }>, true, ["/admin/settings"], (v) => deps.db.setSetting(v)),
    setFlag: (raw: unknown) => run(raw, flagInput, true, ["/admin/settings"], (v) => deps.db.setFlag(v)),
    updatePlan: (raw: unknown) => run(raw, planInput, true, ["/admin/plans"], (v) => deps.db.updatePlan(v)),
    setOrgStatus: (raw: unknown) => run(raw, orgStatusInput, true, ["/admin/organizations"], (v) => deps.db.setOrgStatus(v)),
    setPlatformRole: (raw: unknown) => run(raw, roleInput, true, ["/admin/staff"], (v) => deps.db.setPlatformRole(v)),
    setVisibility: (raw: unknown) => run(raw, hideInput, true, ["/admin/reports", "/admin/reports/hidden"], (v) => deps.db.setVisibility(v)),
    dismissReport: (raw: unknown) => run(raw, dismissInput, true, ["/admin/reports"], (v) => deps.db.dismissReport(v)),
    saveCategory: (raw: unknown) => run(raw, categoryInput, true, ["/admin/taxonomy"], (v) => deps.db.saveCategory(v)),
    saveSkill: (raw: unknown) => run(raw, skillInput, true, ["/admin/taxonomy"], (v) => deps.db.saveSkill(v)),
    reviewVerification: (raw: unknown) => run(raw, verificationReviewInput, true, ["/admin/verification"], (v) => deps.db.reviewVerification(v)),
    revokeVerification: (raw: unknown) => run(raw, revokeVerificationInput, true, ["/admin/verification", "/admin/organizations"], (v) => deps.db.revokeVerification(v)),
    /** A professional action, not an admin one: the database checks the caller owns or administers the organization. */
    requestVerification: async (raw: unknown): Promise<ConsoleResult> => {
      // Validate first so typos in the form do not use up the user's budget.
      if (!verificationRequestInput.safeParse(raw).success) return { ok: false, code: "invalid" };
      if (deps.throttleUser && !(await deps.throttleUser())) return { ok: false, code: "rate" };
      return run(raw, verificationRequestInput, false, ["/settings/verification"], (v) => deps.db.requestVerification(v));
    },
  };
}
