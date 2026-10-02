import { expect, test } from "@playwright/test";

const PROTECTED = ["/dashboard", "/admin", "/onboarding", "/settings/profile"];

for (const path of PROTECTED) {
  test(`anonymous ${path} redirects to /signin and keeps the destination`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/signin\\?next=${encodeURIComponent(path).replace(/\//g, "%2F")}`));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
}

test("sign-in form is labelled and usable by keyboard", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Email").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});

test("security headers are present on HTML responses", async ({ request }) => {
  const res = await request.get("/signin");
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
});

test("API endpoints refuse anonymous callers", async ({ request }) => {
  const res = await request.post("/api/uploads/sign", {
    data: { orgId: "11111111-1111-4111-8111-111111111111", name: "a.pdf", size: 10, declaredMime: "application/pdf" },
  });
  expect(res.status()).toBe(401);
});

for (const path of ["/", "/signin", "/signup", "/reset"]) {
  test(`${path} has no horizontal overflow and no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
