import { expect, test } from "@playwright/test";

test("explore is public, has one h1 and a labelled search box", async ({ page }) => {
  const res = await page.goto("/explore");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("search", { name: "Search the marketplace" })).toBeVisible();
  await expect(page.getByLabel("Search", { exact: true })).toBeVisible();
});

test("explore has no horizontal overflow and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/explore?q=welder");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  // The placeholder database is unreachable here, so only unrelated client errors would count.
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test("explore survives hostile query parameters", async ({ page }) => {
  const res = await page.goto(`/explore?kind=nope&q=${"x".repeat(500)}&category=not-a-uuid&cursor=%00%00`);
  expect(res?.status()).toBe(200);
});

test("an invalid profile or service slug is a 404, not a redirect", async ({ request }) => {
  for (const path of ["/p/NOT%20A%20SLUG", "/p/..%2Fetc", "/services/UPPER_case"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
  }
});

test("explore keeps the strict CSP with a nonce", async ({ request }) => {
  const res = await request.get("/explore");
  expect(res.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
});

for (const path of ["/projects", "/projects/new", "/messages", "/notifications", "/profile", "/services"]) {
  test(`signed-in area ${path} still redirects to /signin`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent(path)}`);
  });
}

test("public service pages are not gated", async ({ request }) => {
  const res = await request.get("/services/logo-design", { maxRedirects: 0 });
  expect(res.status()).not.toBe(307);
});

test("search API rejects bad params with 400 and never leaks internals", async ({ request }) => {
  const res = await request.get("/api/search?kind=x");
  expect(res.status()).toBe(400);
  expect(await res.text()).not.toMatch(/supabase|postgres|stack/i);
});
