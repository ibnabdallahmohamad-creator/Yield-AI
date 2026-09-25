import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (`npm run test:e2e`). The dev server runs with USE_MOCK=true (accounts and their
 * farms in a throw-away local store) and a stand-in for the Open-Meteo API (e2e/fixtures), so the
 * tests need no network. An already running server on the same port is reused as it is.
 * Set E2E_BASE_URL to test a deployed copy instead.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OPEN_METEO_PORT = 3999;

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
    : [
        {
          command: `node e2e/fixtures/open-meteo.mjs ${OPEN_METEO_PORT}`,
          url: `http://localhost:${OPEN_METEO_PORT}/v1/forecast?latitude=25.6&longitude=51.4`,
          reuseExistingServer: true,
          timeout: 30_000,
        },
        {
          command: "npm run dev",
          url: `${baseURL}/api/health`,
          reuseExistingServer: true,
          timeout: 240_000,
          env: {
            USE_MOCK: "true",
            LOCAL_DATA_DIR: path.join(os.tmpdir(), `yield-ai-e2e-${Date.now()}`),
            OPEN_METEO_BASE_URL: `http://localhost:${OPEN_METEO_PORT}`,
          },
        },
      ],
});
