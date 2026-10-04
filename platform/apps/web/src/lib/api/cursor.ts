const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface Cursor { ts: string; id: string }

/** The timestamp stays the exact text the database returned: a JS Date would drop the microseconds and skip or repeat rows. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.ts}|${c.id}`).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  if (parts.length !== 2 || !TS.test(parts[0]!) || !UUID.test(parts[1]!)) return null;
  const d = parts[0]!.slice(0, 10);
  const probe = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(Date.parse(parts[0]!)) || probe.toISOString().slice(0, 10) !== d) return null; // impossible dates would reach the database as a cast error
  return { ts: parts[0]!, id: parts[1]! };
}
