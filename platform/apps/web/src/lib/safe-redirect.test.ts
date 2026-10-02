import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it.each([
    "https://evil.example",
    "http://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
    "data:text/html,hi",
    "",
    "evil.example",
  ])("falls back to /dashboard for %j", (input) => {
    expect(safeRedirect(input)).toBe("/dashboard");
  });
  it("falls back for null and undefined", () => {
    expect(safeRedirect(null)).toBe("/dashboard");
    expect(safeRedirect(undefined)).toBe("/dashboard");
  });
  it("preserves same-origin paths with query and hash", () => {
    expect(safeRedirect("/projects?x=1#top")).toBe("/projects?x=1#top");
    expect(safeRedirect("/admin")).toBe("/admin");
  });
  it("honours a custom fallback", () => {
    expect(safeRedirect("https://evil.example", "/home")).toBe("/home");
  });
});
