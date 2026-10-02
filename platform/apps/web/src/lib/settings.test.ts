import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSettings } from "./settings";

describe("settings service", () => {
  let now = 0;
  beforeEach(() => {
    now = 1_000;
  });

  it("caches a setting within the TTL and refreshes after it", async () => {
    const loader = vi.fn(async (_key: string) => 500);
    const s = createSettings({ loadSetting: loader, loadFlag: async () => false, now: () => now, ttlMs: 60_000 });
    expect(await s.getSetting("commission.professional_bps", z.number())).toBe(500);
    now += 30_000;
    await s.getSetting("commission.professional_bps", z.number());
    expect(loader).toHaveBeenCalledTimes(1);
    now += 31_000;
    await s.getSetting("commission.professional_bps", z.number());
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("rejects a stored value that does not match the schema", async () => {
    const s = createSettings({ loadSetting: async () => "not-a-number", loadFlag: async () => false, now: () => now });
    await expect(s.getSetting("commission.client_bps", z.number())).rejects.toThrow();
  });

  it("getCommissionBps reads both commission settings", async () => {
    const values: Record<string, unknown> = { "commission.professional_bps": 500, "commission.client_bps": 200 };
    const s = createSettings({ loadSetting: async (k) => values[k], loadFlag: async () => false, now: () => now });
    expect(await s.getCommissionBps()).toEqual({ professional: 500, client: 200 });
  });

  it("isFlagEnabled defers to the loader with the org id", async () => {
    const loadFlag = vi.fn(async (_k: string, org?: string) => org === "org-1");
    const s = createSettings({ loadSetting: async () => 0, loadFlag, now: () => now });
    expect(await s.isFlagEnabled("ai.assistant", "org-1")).toBe(true);
    expect(await s.isFlagEnabled("ai.assistant", "org-2")).toBe(false);
  });
});
