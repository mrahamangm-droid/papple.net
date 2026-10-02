import { describe, expect, it, vi } from "vitest";
import { createConsent } from "./consent";

function memoryStorage(initial?: string) {
  let v: string | null = initial ?? null;
  return { getItem: () => v, setItem: (_k: string, val: string) => { v = val; } };
}

describe("consent-gated analytics", () => {
  it("does not initialise analytics without consent", () => {
    const init = vi.fn();
    const c = createConsent({ storage: memoryStorage(), initAnalytics: init });
    expect(c.get()).toBe("unset");
    c.startIfGranted();
    expect(init).not.toHaveBeenCalled();
  });
  it("initialises exactly once after consent is granted", () => {
    const init = vi.fn();
    const c = createConsent({ storage: memoryStorage(), initAnalytics: init });
    c.set("granted");
    c.startIfGranted();
    c.startIfGranted();
    expect(init).toHaveBeenCalledTimes(1);
  });
  it("never initialises after denial, including on later page loads", () => {
    const init = vi.fn();
    const first = createConsent({ storage: memoryStorage(), initAnalytics: init });
    first.set("denied");
    const reload = createConsent({ storage: memoryStorage("denied"), initAnalytics: init });
    reload.startIfGranted();
    expect(init).not.toHaveBeenCalled();
  });
  it("treats unreadable or tampered storage as unset (no tracking)", () => {
    const init = vi.fn();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const c = createConsent({ storage: broken, initAnalytics: init });
    expect(c.get()).toBe("unset");
    expect(() => c.set("granted")).not.toThrow();
    c.startIfGranted();
    expect(createConsent({ storage: memoryStorage("yes please"), initAnalytics: init }).get()).toBe("unset");
  });
});
