import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
// Dummy values: anonymous flows never reach a real Supabase. Authenticated e2e needs a live staging project.
const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "placeholder",
  R2_ACCOUNT_ID: "placeholder", R2_ACCESS_KEY_ID: "placeholder", R2_SECRET_ACCESS_KEY: "placeholder", R2_BUCKET: "placeholder",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: `pnpm exec next start -p ${PORT}`, port: PORT, reuseExistingServer: false, env },
});
