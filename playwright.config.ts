import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (`npm run test:e2e`). They run against the built-in demo data: the dev server
 * is started with USE_MOCK=true, or an already running one on the same port is reused.
 * Set E2E_BASE_URL to test a deployed copy instead.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One worker: the dev server compiles each route on its first request.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 240_000,
        env: { USE_MOCK: "true" },
      },
});
