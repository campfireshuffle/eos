import { defineConfig, devices } from "@playwright/test"

/**
 * Browser tests for editing across tabs, history and agent tools. Run with `pnpm e2e`.
 * They run against a production build served by `vite preview`, which applies public/_headers (the CSP) as Cloudflare does.
 * The preview has its own port, never the dev server's, and is never reused, so tests can't quietly run against
 * `pnpm dev` or a stale build. `pnpm build` is a turbo cache hit when the build is current, as in CI, where it runs just before.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm --filter @eos/web preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
})
