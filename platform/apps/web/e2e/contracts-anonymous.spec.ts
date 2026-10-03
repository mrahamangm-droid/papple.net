import { expect, test } from "@playwright/test";

for (const path of ["/contracts", "/contracts/11111111-1111-4111-8111-111111111111", "/settings/payouts", "/settings/verification"]) {
  test(`signed-in area ${path} redirects to /signin`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent(path)}`);
  });
}

test("the Stripe webhook refuses unsigned requests and is never a 200 or a crash", async ({ request }) => {
  // 503 when Stripe keys are not configured (as here), 400 once they are. Either way nothing is applied.
  const res = await request.post("/api/webhooks/stripe", { data: "{}", headers: { "content-type": "application/json" } });
  expect([400, 503]).toContain(res.status());
});

test("the Stripe webhook refuses a forged signature", async ({ request }) => {
  const res = await request.post("/api/webhooks/stripe", {
    data: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed" }),
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
  });
  expect([400, 503]).toContain(res.status());
});

test("the webhook only accepts POST", async ({ request }) => {
  const res = await request.get("/api/webhooks/stripe", { maxRedirects: 0 });
  expect(res.status()).toBe(405);
});

for (const path of ["/admin/disputes", "/admin/disputes/11111111-1111-4111-8111-111111111111", "/admin/settings", "/admin/plans", "/admin/audit", "/admin/organizations", "/admin/staff", "/admin/verification", "/admin/reports", "/admin/reports/hidden", "/admin/taxonomy"]) {
  test(`admin area ${path} redirects to /signin`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent(path)}`);
  });
}
