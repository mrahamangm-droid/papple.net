import { expect, test } from "@playwright/test";

for (const path of ["/approvals", "/settings/approvals"]) {
  test(`signed-in area ${path} redirects to /signin`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent(path)}`);
  });
}
