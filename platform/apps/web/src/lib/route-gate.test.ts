import { describe, expect, it } from "vitest";
import { isProtectedPath } from "./route-gate";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/admin/users", "/onboarding", "/settings/profile", "/projects", "/projects/new", "/projects/abc", "/messages", "/messages/1", "/notifications", "/profile", "/services"])(
    "protects %s", (p) => expect(isProtectedPath(p)).toBe(true));
  it.each(["/", "/signin", "/explore", "/p/jane-doe", "/services/logo-design", "/services/a/b", "/projectsx", "/profiles"])(
    "leaves %s public", (p) => expect(isProtectedPath(p)).toBe(false));
});
