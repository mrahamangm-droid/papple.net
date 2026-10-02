import type { ZodType } from "zod";
import { z } from "zod";

export interface SettingsDeps {
  loadSetting: (key: string) => Promise<unknown>;
  loadFlag: (key: string, orgId?: string) => Promise<boolean>;
  now?: () => number;
  ttlMs?: number;
}

export function createSettings(deps: SettingsDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? 60_000;
  const cache = new Map<string, { at: number; value: unknown }>();

  async function getSetting<T>(key: string, schema: ZodType<T>): Promise<T> {
    const hit = cache.get(key);
    let raw: unknown;
    if (hit && now() - hit.at < ttl) raw = hit.value;
    else {
      raw = await deps.loadSetting(key);
      cache.set(key, { at: now(), value: raw });
    }
    return schema.parse(raw);
  }

  const bps = z.number().int().min(0).max(10_000);
  async function getCommissionBps() {
    const [professional, client] = await Promise.all([
      getSetting("commission.professional_bps", bps),
      getSetting("commission.client_bps", bps),
    ]);
    return { professional, client };
  }

  const isFlagEnabled = (key: string, orgId?: string) => deps.loadFlag(key, orgId);

  return { getSetting, getCommissionBps, isFlagEnabled };
}
