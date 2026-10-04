import { describe, expect, it } from "vitest";
import { CHECKED_COPY, credentialFailureMessage, kindLabel, statusLabel, ownerStatusLabel, type CredentialFailure } from "./present";

describe("credential wording", () => {
  it("labels kinds and falls back safely", () => {
    expect(kindLabel("licence")).toBe("Licence"); expect(kindLabel("degree")).toBe("Degree"); expect(kindLabel("zzz")).toBe("Credential");
  });
  it("shows the public status honestly: checked is not certified, declared is not checked", () => {
    expect(statusLabel("checked")).toBe("Checked by PAPple");
    expect(statusLabel("declared")).toBe("Self-declared");
    expect(statusLabel("expired")).toBe("Expired");
    expect(statusLabel("whatever")).toBe("Self-declared");
  });
  it("the public copy says what checked does not mean", () => {
    expect(CHECKED_COPY).toMatch(/reviewed the evidence/i);
    expect(CHECKED_COPY).toMatch(/not .*certif/i);
  });
  it("tells owners where each credential stands, including what to do next", () => {
    expect(ownerStatusLabel("declared")).toMatch(/self-declared/i);
    expect(ownerStatusLabel("pending")).toMatch(/waiting/i);
    expect(ownerStatusLabel("checked")).toMatch(/checked/i);
    expect(ownerStatusLabel("rejected")).toMatch(/not shown/i);
    expect(ownerStatusLabel("revoked")).toMatch(/revoked/i);
    expect(ownerStatusLabel("revoked")).toMatch(/delete/i);
  });
  it("has a plain message for every failure", () => {
    const codes: CredentialFailure[] = ["forbidden", "invalid", "limit", "rate", "error"];
    for (const c of codes) expect(credentialFailureMessage(c).length).toBeGreaterThan(10);
    expect(credentialFailureMessage("invalid")).toMatch(/evidence|details/i);
  });
});
