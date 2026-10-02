export type ConsentValue = "granted" | "denied" | "unset";
const KEY = "papple_consent_v1";

export interface ConsentDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  initAnalytics: () => void;
}

/** Analytics start only after an explicit "granted"; anything unreadable counts as no consent. */
export function createConsent(deps: ConsentDeps) {
  let started = false;
  const get = (): ConsentValue => {
    try {
      const v = deps.storage.getItem(KEY);
      return v === "granted" || v === "denied" ? v : "unset";
    } catch {
      return "unset";
    }
  };
  const set = (v: Exclude<ConsentValue, "unset">) => {
    try {
      deps.storage.setItem(KEY, v);
    } catch {
      /* storage blocked: consent is not persisted */
    }
    if (v === "granted") startIfGranted();
  };
  const startIfGranted = () => {
    if (started || get() !== "granted") return;
    started = true;
    deps.initAnalytics();
  };
  return { get, set, startIfGranted };
}
