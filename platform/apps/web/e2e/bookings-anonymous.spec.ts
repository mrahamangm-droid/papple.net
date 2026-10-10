import { expect, test } from "@playwright/test";

for (const path of ["/bookings", "/settings/bookings"]) {
  test(`signed-in area ${path} redirects to /signin`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent(path)}`);
  });
}

test("the calendar file needs a signed-in member", async ({ request }) => {
  const res = await request.get("/api/bookings/11111111-1111-4111-8111-111111111111/ics?org=22222222-2222-4222-8222-222222222222", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});
