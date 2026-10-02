import { createHash } from "node:crypto";

export type AuditOutcome = "success" | "denied" | "invalid" | "error";

export interface AuditEntry {
  actorId: string | null;
  orgId?: string;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  requestId: string;
  ip?: string;
  outcome: AuditOutcome;
}

const SENSITIVE = /password|token|secret|key/i;

/** Deep copy with values of sensitive keys replaced; never mutates its input. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? "[REDACTED]" : redact(v)]),
    );
  }
  return value;
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export function createAuditWriter(insert: (row: Record<string, unknown>) => Promise<void>, ipSalt: string) {
  return async function writeAudit(entry: AuditEntry): Promise<void> {
    await insert({
      actor_id: entry.actorId,
      org_id: entry.orgId ?? null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      before: redact(entry.before) ?? null,
      after: redact(entry.after) ?? null,
      outcome: entry.outcome,
      request_id: entry.requestId,
      ip_hash: entry.ip ? hashIp(entry.ip, ipSalt) : null,
    });
  };
}
