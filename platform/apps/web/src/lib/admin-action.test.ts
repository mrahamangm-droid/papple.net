import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAdminAction, ForbiddenError, UnauthenticatedError, ValidationError } from "./admin-action";

function setup(opts: { userId: string | null; admin: boolean }) {
  const audit = vi.fn(async () => {});
  const adminAction = createAdminAction({
    getUserId: async () => opts.userId,
    isPlatformAdmin: async () => opts.admin,
    audit,
    requestId: () => "req-1",
  });
  const handler = vi.fn(async (input: { n: number }) => input.n * 2);
  const action = adminAction({ name: "demo.double", input: z.object({ n: z.number() }), handler });
  return { action, handler, audit };
}

describe("adminAction", () => {
  it("rejects non-admins with ForbiddenError, skips the handler and audits a denial", async () => {
    const { action, handler, audit } = setup({ userId: "u1", admin: false });
    await expect(action({ n: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(handler).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u1", action: "demo.double", outcome: "denied" }));
  });
  it("rejects anonymous callers with UnauthenticatedError", async () => {
    const { action, handler, audit } = setup({ userId: null, admin: false });
    await expect(action({ n: 1 })).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(handler).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, outcome: "denied" }));
  });
  it("validates input before running the handler", async () => {
    const { action, handler, audit } = setup({ userId: "u1", admin: true });
    await expect(action({ n: "nope" })).rejects.toBeInstanceOf(ValidationError);
    expect(handler).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "invalid" }));
  });
  it("runs the handler for admins and audits success", async () => {
    const { action, audit } = setup({ userId: "u1", admin: true });
    await expect(action({ n: 4 })).resolves.toBe(8);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", requestId: "req-1" }));
  });
  it("audits and rethrows handler errors", async () => {
    const audit = vi.fn(async () => {});
    const adminAction = createAdminAction({ getUserId: async () => "u1", isPlatformAdmin: async () => true, audit, requestId: () => "r" });
    const action = adminAction({ name: "demo.fail", input: z.object({}), handler: async () => { throw new Error("boom"); } });
    await expect(action({})).rejects.toThrow("boom");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });
});
