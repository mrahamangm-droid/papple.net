import type { ZodType } from "zod";
import type { AuditEntry } from "./audit";

export class UnauthenticatedError extends Error {
  constructor() { super("Authentication required"); this.name = "UnauthenticatedError"; }
}
export class ForbiddenError extends Error {
  constructor() { super("Forbidden"); this.name = "ForbiddenError"; }
}
export class ValidationError extends Error {
  constructor(public readonly issues: unknown) { super("Invalid input"); this.name = "ValidationError"; }
}

export interface AdminActionDeps {
  getUserId: () => Promise<string | null>;
  isPlatformAdmin: (userId: string) => Promise<boolean>;
  audit: (entry: AuditEntry) => Promise<void>;
  requestId: () => string;
}

export function createAdminAction(deps: AdminActionDeps) {
  return function adminAction<I, O>(opts: {
    name: string;
    input: ZodType<I>;
    handler: (input: I, ctx: { userId: string }) => Promise<O>;
  }) {
    return async (raw: unknown): Promise<O> => {
      const requestId = deps.requestId();
      const base = { action: opts.name, entity: opts.name, requestId };
      const userId = await deps.getUserId();
      if (!userId) {
        await deps.audit({ ...base, actorId: null, outcome: "denied" });
        throw new UnauthenticatedError();
      }
      if (!(await deps.isPlatformAdmin(userId))) {
        await deps.audit({ ...base, actorId: userId, outcome: "denied" });
        throw new ForbiddenError();
      }
      const parsed = opts.input.safeParse(raw);
      if (!parsed.success) {
        await deps.audit({ ...base, actorId: userId, outcome: "invalid" });
        throw new ValidationError(parsed.error.issues);
      }
      try {
        const result = await opts.handler(parsed.data, { userId });
        await deps.audit({ ...base, actorId: userId, after: parsed.data, outcome: "success" });
        return result;
      } catch (e) {
        await deps.audit({ ...base, actorId: userId, outcome: "error" });
        throw e;
      }
    };
  };
}
