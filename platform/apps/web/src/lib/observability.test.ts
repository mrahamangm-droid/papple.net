import { describe, expect, it } from "vitest";
import { connectSources, scrubEvent } from "./observability";

describe("scrubEvent", () => {
  it("removes cookies and auth headers from the request", () => {
    const e = scrubEvent({
      request: { headers: { cookie: "sb=secret", Authorization: "Bearer abc", "x-api-key": "k", accept: "text/html" }, cookies: { a: "b" } },
    }) as { request: { headers: Record<string, string>; cookies?: unknown } };
    expect(e.request.headers.cookie).toBeUndefined();
    expect(e.request.headers.Authorization).toBeUndefined();
    expect(e.request.headers["x-api-key"]).toBeUndefined();
    expect(e.request.headers.accept).toBe("text/html");
    expect(e.request.cookies).toBeUndefined();
  });
  it("masks email addresses and JWT-like tokens anywhere in the event", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123_-";
    const e = scrubEvent({ message: `failed for jane@example.com with ${jwt}`, extra: { nested: ["bob@corp.io"] } });
    const s = JSON.stringify(e);
    expect(s).not.toContain("jane@example.com");
    expect(s).not.toContain("bob@corp.io");
    expect(s).not.toContain(jwt);
  });
  it("drops user email and ip address but keeps the opaque id", () => {
    const e = scrubEvent({ user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4", username: "jane" } }) as { user: Record<string, unknown> };
    expect(e.user).toEqual({ id: "u1" });
  });
  it("does not mutate the input and tolerates events without those fields", () => {
    const input = { request: { headers: { cookie: "x" } } };
    scrubEvent(input);
    expect(input.request.headers.cookie).toBe("x");
    expect(scrubEvent({})).toEqual({});
  });
});

describe("connectSources", () => {
  it("derives CSP connect-src origins from the Sentry DSN and PostHog host", () => {
    expect(connectSources({ SENTRY_DSN: "https://abc123@o1.ingest.sentry.io/42", NEXT_PUBLIC_POSTHOG_KEY: "phc_x" })).toEqual([
      "https://o1.ingest.sentry.io",
      "https://us.i.posthog.com",
    ]);
  });
  it("returns nothing when neither is configured and ignores a malformed DSN", () => {
    expect(connectSources({})).toEqual([]);
    expect(connectSources({ SENTRY_DSN: "not a url" })).toEqual([]);
  });
});
