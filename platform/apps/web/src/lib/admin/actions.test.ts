import { describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotAllowedError } from "../marketplace/errors";
import { createAdminConsoleActions } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const reason = "A perfectly good reason";

function setup(aal2 = true) {
  const db = {
    setSetting: vi.fn(async (_i: unknown) => undefined), setFlag: vi.fn(async (_i: unknown) => undefined), updatePlan: vi.fn(async (_i: unknown) => undefined),
    setOrgStatus: vi.fn(async (_i: unknown) => undefined), setPlatformRole: vi.fn(async (_i: unknown) => undefined),
    requestVerification: vi.fn(async (_i: unknown) => undefined), setVisibility: vi.fn(async (_i: unknown) => undefined), dismissReport: vi.fn(async (_i: unknown) => undefined), saveCategory: vi.fn(async (_i: unknown) => undefined), saveSkill: vi.fn(async (_i: unknown) => undefined), reviewVerification: vi.fn(async (_i: unknown) => undefined), revokeVerification: vi.fn(async (_i: unknown) => undefined),
  };
  const revalidate = vi.fn();
  return { db, revalidate, actions: createAdminConsoleActions({ db, revalidate, hasSecondFactor: async () => aal2 }) };
}

describe("admin console actions", () => {
  it("sets a setting through the database and refreshes the page", async () => {
    const { actions, db, revalidate } = setup();
    expect(await actions.setSetting({ key: "commission.client_bps", value: 250, reason })).toEqual({ ok: true });
    expect(db.setSetting).toHaveBeenCalledWith({ key: "commission.client_bps", value: 250, reason });
    expect(revalidate).toHaveBeenCalledWith("/admin/settings");
  });
  it("refuses a value outside the registry before any database call", async () => {
    const { actions, db } = setup();
    expect(await actions.setSetting({ key: "commission.client_bps", value: 10001, reason })).toEqual({ ok: false, code: "invalid" });
    expect(db.setSetting).not.toHaveBeenCalled();
  });
  it("refuses every admin action without a second factor, before any database call", async () => {
    const { actions, db } = setup(false);
    const results = await Promise.all([
      actions.setSetting({ key: "commission.client_bps", value: 250, reason }),
      actions.setFlag({ key: "ai.assistant", enabled: true, reason }),
      actions.updatePlan({ key: "free", name: "Free", priceCents: 0, active: true, limits: {}, features: {}, reason }),
      actions.setOrgStatus({ orgId: id, status: "suspended", reason }),
      actions.setPlatformRole({ userId: id, role: "support", grant: true, reason }),
      actions.reviewVerification({ requestId: id, decision: "approved", note: reason }),
      actions.revokeVerification({ orgId: id, reason }),
      actions.setVisibility({ kind: "profile", id, hidden: true, reason }),
      actions.dismissReport({ reportId: id, reason }),
      actions.saveCategory({ id: null, slug: "web-design", name: "Web design", parentId: null, position: 1, active: true, reason }),
      actions.saveSkill({ id: null, slug: "figma", name: "Figma", categoryId: null, active: true, reason }),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, code: "forbidden" });
    for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
  });
  it("rejects malformed input without calling the database", async () => {
    const { actions, db } = setup();
    expect(await actions.setFlag({ key: "ai.assistant", enabled: "yes", reason })).toEqual({ ok: false, code: "invalid" });
    expect(await actions.setOrgStatus({ orgId: "nope", status: "suspended", reason })).toEqual({ ok: false, code: "invalid" });
    expect(await actions.setPlatformRole({ userId: id, role: "root", grant: true, reason })).toEqual({ ok: false, code: "invalid" });
    expect(db.setFlag).not.toHaveBeenCalled();
    expect(db.setOrgStatus).not.toHaveBeenCalled();
    expect(db.setPlatformRole).not.toHaveBeenCalled();
  });
  it("maps database refusals to codes and never throws", async () => {
    const { actions, db, revalidate } = setup();
    db.setOrgStatus.mockRejectedValueOnce(new NotAllowedError());
    expect(await actions.setOrgStatus({ orgId: id, status: "suspended", reason })).toEqual({ ok: false, code: "forbidden" });
    db.setPlatformRole.mockRejectedValueOnce(new InvalidInputError());
    expect(await actions.setPlatformRole({ userId: id, role: "admin", grant: false, reason })).toEqual({ ok: false, code: "invalid" });
    db.setFlag.mockRejectedValueOnce(new Error("boom"));
    expect(await actions.setFlag({ key: "ai.assistant", enabled: true, reason })).toEqual({ ok: false, code: "error" });
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("lets an organization owner request verification without a second factor", async () => {
    const { actions, db, revalidate } = setup(false);
    expect(await actions.requestVerification({ orgId: id, note: "Registered company number 123", url: "https://example.com/p" })).toEqual({ ok: true });
    expect(db.requestVerification).toHaveBeenCalledWith({ orgId: id, note: "Registered company number 123", url: "https://example.com/p" });
    expect(revalidate).toHaveBeenCalledWith("/settings/verification");
    expect(await actions.requestVerification({ orgId: id, note: "short", url: "" })).toEqual({ ok: false, code: "invalid" });
  });
  it("rate-limits verification requests per user and never reaches the database when limited", async () => {
    const db = setup(false).db;
    const a = createAdminConsoleActions({ db, revalidate: vi.fn(), hasSecondFactor: async () => false, throttleUser: async () => false });
    expect(await a.requestVerification({ orgId: id, note: "Registered company number 123", url: "" })).toEqual({ ok: false, code: "rate" });
    expect(db.requestVerification).not.toHaveBeenCalled();
  });
  it("does not spend rate-limit budget on invalid input", async () => {
    const db = setup(false).db;
    const throttleUser = vi.fn(async () => true);
    const a = createAdminConsoleActions({ db, revalidate: vi.fn(), hasSecondFactor: async () => false, throttleUser });
    expect(await a.requestVerification({ orgId: id, note: "short", url: "" })).toEqual({ ok: false, code: "invalid" });
    expect(throttleUser).not.toHaveBeenCalled();
  });
  it("refreshes the queue after a review", async () => {
    const { actions, revalidate } = setup();
    expect(await actions.reviewVerification({ requestId: id, decision: "approved", note: reason })).toEqual({ ok: true });
    expect(revalidate).toHaveBeenCalledWith("/admin/verification");
  });
  it("moderation and taxonomy actions call the database and refresh their pages", async () => {
    const { actions, db, revalidate } = setup();
    expect(await actions.setVisibility({ kind: "project", id, hidden: true, reason })).toEqual({ ok: true });
    expect(db.setVisibility).toHaveBeenCalledWith({ kind: "project", id, hidden: true, reason });
    expect(revalidate).toHaveBeenCalledWith("/admin/reports");
    expect(await actions.dismissReport({ reportId: id, reason })).toEqual({ ok: true });
    expect(await actions.saveCategory({ id: null, slug: "web-design", name: "Web design", parentId: null, position: 1, active: true, reason })).toEqual({ ok: true });
    expect(revalidate).toHaveBeenCalledWith("/admin/taxonomy");
    expect(await actions.setVisibility({ kind: "message", id, hidden: true, reason })).toEqual({ ok: false, code: "invalid" });
  });
});
