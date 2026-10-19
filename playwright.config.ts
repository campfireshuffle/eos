import { defineConfig, devices } from "@playwright/test"

/** Browser tests for editing across tabs, history and agent tools. Run with `pnpm e2e`. */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @eos/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
})
