import { describe, expect, it, vi } from "vitest";
import { createCronHandler } from "./cron-handler";

const req = (auth?: string) => new Request("http://x/api/cron/notify-email", { headers: auth ? { authorization: auth } : {} });

describe("cron handler", () => {
  it("is unavailable (503) when no secret is configured, and never runs the job", async () => {
    const run = vi.fn(async () => ({ sent: 1 }));
    const res = await createCronHandler({ secret: () => undefined, run })(req("Bearer anything"));
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects a missing or wrong bearer token with 401", async () => {
    const run = vi.fn(async () => ({ sent: 1 }));
    const h = createCronHandler({ secret: () => "s3cret-value", run });
    expect((await h(req())).status).toBe(401);
    expect((await h(req("Bearer wrong-value!"))).status).toBe(401);
    expect((await h(req("Bearer s3cret-value-and-more"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("runs the job with the right token and reports the count only", async () => {
    const h = createCronHandler({ secret: () => "s3cret-value", run: async () => ({ sent: 3 }) });
    const res = await h(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 3 });
  });
  it("hides job failures behind a generic 500", async () => {
    const h = createCronHandler({ secret: () => "s3cret-value", run: async () => { throw new Error("db password=abc"); } });
    const res = await h(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/password/);
  });
});
