import { expect, test } from "@playwright/test";

for (const [path, heading] of [["/terms", "Terms of Service"], ["/privacy", "Privacy Policy"], ["/cookies", "Cookie Policy"], ["/marketplace-rules", "Marketplace Rules"], ["/status", "Status"]] as const) {
  test(`${path} is public and labelled`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Legal" })).toBeVisible();
  });
}

test("legal pages show the draft notice while unreviewed", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByRole("note")).toContainText("pending legal review");
});

test("robots.txt blocks signed-in areas and lists the sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const t = await res.text();
  expect(t).toContain("Disallow: /admin/");
  expect(t).toContain("Disallow: /api/");
  expect(t).toContain("Sitemap: ");
});

test("sitemap.xml serves static pages and never gated paths", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const t = await res.text();
  expect(t).toContain("/terms");
  expect(t).not.toMatch(/<loc>https?:\/\/[^/]+\/(admin|dashboard|settings)(\/|<)/);
});

test("unknown paths return a branded 404", async ({ page }) => {
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
});

test("security.txt is served and does not invent a contact", async ({ request }) => {
  const res = await request.get("/.well-known/security.txt");
  expect(res.status()).toBe(200);
  const t = await res.text();
  expect(t).toContain("Expires:");
  expect(t).not.toContain("mailto:");
});

test("the home page links to the legal pages", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Legal" });
  for (const name of ["Terms", "Privacy", "Cookies"]) await expect(nav.getByRole("link", { name })).toBeVisible();
});
