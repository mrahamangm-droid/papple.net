import { expect, test } from "@playwright/test";

for (const path of ["/contracts", "/contracts/11111111-1111-4111-8111-111111111111", "/settings/payouts", "/settings/verification", "/settings/billing", "/settings/invoicing", "/crm", "/crm/33333333-3333-4333-8333-333333333333","/contracts/11111111-1111-4111-8111-111111111111/invoices/22222222-2222-4222-8222-222222222222"]) {
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

test("the Resend webhook refuses unsigned and forged requests and acts on nothing", async ({ request }) => {
  // 503 when RESEND_WEBHOOK_SECRET is not configured (as here), 401 once it is.
  const body = JSON.stringify({ type: "email.complained", data: { email_id: "prov_forged" } });
  const unsigned = await request.post("/api/webhooks/resend", { data: body, headers: { "content-type": "application/json" } });
  expect([401, 503]).toContain(unsigned.status());
  const forged = await request.post("/api/webhooks/resend", { data: body, headers: { "content-type": "application/json", "svix-id": "m1", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" } });
  expect([401, 503]).toContain(forged.status());
  expect((await request.get("/api/webhooks/resend", { maxRedirects: 0 })).status()).toBe(405);
});

test("the public unsubscribe page rejects a missing or forged token and is never a redirect to sign-in", async ({ request }) => {
  // 503 when CRM_UNSUBSCRIBE_SECRET is not configured (as here), 400 once it is. Never 200, never a redirect.
  for (const t of ["", "?t=", "?t=forged.token", "?t=" + "x".repeat(700)]) {
    const get = await request.get(`/crm-unsubscribe${t}`, { maxRedirects: 0 });
    expect([400, 503]).toContain(get.status());
    const post = await request.post(`/crm-unsubscribe${t}`, { maxRedirects: 0 });
    expect([400, 503]).toContain(post.status());
    expect(get.headers()["x-robots-tag"]).toContain("noindex");
    expect(get.headers()["cache-control"]).toContain("no-store");
  }
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
