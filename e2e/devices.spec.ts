import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { collectPageErrors, signIn } from "./helpers";

/**
 * A real account and its ESP32: starts empty (no demo data), pairs a device with a code, receives
 * its readings over the device API, follows the reading interval, and charts every reading. Runs
 * with local accounts (no Supabase), which is how the e2e server starts.
 */

async function localAccounts(request: APIRequestContext): Promise<boolean> {
  const health = await (await request.get("/api/health")).json();
  return String(health.accounts ?? "").startsWith("local");
}

async function signUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("E2E Grower");
  await page.getByLabel("Email", { exact: true }).fill(`e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-42");
  await page.getByRole("button", { name: /create|sign up/i }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), { timeout: 60_000 });
}

const FARM = { name: "E2E Greenhouse", lat: 25.68, lng: 51.5, area_ha: 3, main_crop: "tomato", planting_date: "2026-09-01" };

test.describe("accounts and ESP32 devices", () => {
  test("a new account starts empty, pairs an ESP32 and receives its readings", async ({ page, request }) => {
    test.skip(!(await localAccounts(request)), "needs local accounts");
    const errors = collectPageErrors(page);
    await signUp(page);

    // No demo data: no farms, the demo farms don't exist for this account, and it's asked to add one.
    expect((await (await page.request.get("/api/farms")).json()).farms).toEqual([]);
    expect((await page.request.get("/api/readings/series?farm=khor-north&range=24h")).status()).toBe(404);
    await page.goto("/dashboard/devices");
    await expect(page.getByRole("button", { name: /add your first farm/i })).toBeVisible();

    const farm = (await (await page.request.post("/api/farms", { data: FARM })).json()).farm;
    const created = await page.request.post("/api/devices", { data: { farm_id: farm.id, name: "Bench probe" } });
    expect(created.status()).toBe(201);
    const { device } = await created.json();
    expect(device.interval_s).toBe(10);

    // The ESP32 side: no session, just the pairing code, then its token.
    const pair = await request.post("/api/device/pair", { data: { code: device.pairing_code, firmware: "e2e-1.0.0", rssi: -61 } });
    expect(pair.status()).toBe(200);
    const paired = await pair.json();
    expect(paired).toMatchObject({ farm_id: farm.id, interval_s: 10 });
    expect(paired.token).toMatch(/^yd_/);
    expect((await request.post("/api/device/pair", { data: { code: device.pairing_code } })).status()).toBe(404);

    const auth = { Authorization: `Bearer ${paired.token}` };
    const now = Math.floor(Date.now() / 1000);
    const batch = await request.post("/api/readings", {
      headers: auth,
      data: { readings: [0, 1, 2].map((i) => ({ timestamp: now - 30 + i * 10, moisture: 20 + i, temperature: 27, ec_us_cm: 1800, ph: 7.8 })), rssi: -59 },
    });
    expect(batch.status()).toBe(201);
    expect(await batch.json()).toMatchObject({ stored: 3, interval_s: 10, sensor_id: device.sensor_id });

    expect((await request.post("/api/readings", { headers: auth, data: { moisture: 250 } })).status()).toBe(422);
    expect((await request.post("/api/readings", { headers: { Authorization: "Bearer yd_not-a-real-device-token" }, data: { moisture: 20 } })).status()).toBe(401);

    // The dashboard sets the interval; the device learns it from its next reply.
    const patched = await page.request.patch("/api/devices", { data: { interval_s: 30 } });
    expect((await patched.json()).devices[0].interval_s).toBe(30);
    const next = await request.post("/api/readings", { headers: auth, data: { moisture: 23 } });
    expect((await next.json()).interval_s).toBe(30);

    const series = await (await page.request.get(`/api/readings/series?farm=${farm.id}&range=1h`)).json();
    expect(series.readings).toBe(4);
    expect(series.sensors).toEqual([device.sensor_id]);
    expect(series.metrics.moisture.summary.latest.value).toBe(23);

    await page.goto("/dashboard/devices");
    await expect(page.getByText("Bench probe", { exact: true })).toBeVisible();
    await expect(page.getByText("Online", { exact: true })).toBeVisible();

    await page.goto(`/dashboard/farm/${farm.id}?tab=readings`);
    await expect(page.getByText(/4 readings from 1 probe/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the demo account keeps its sample farms and can't add its own", async ({ page }) => {
    await signIn(page);
    const res = await page.request.post("/api/farms", { data: FARM });
    expect(res.status()).toBe(403);
    await page.goto("/dashboard/devices");
    await expect(page.getByRole("heading", { name: "Connect your own ESP32 probes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
  });

  test("the health check reports devices and the 12-hour forecast", async ({ request }) => {
    const health = await (await request.get("/api/health")).json();
    expect(health.ingest).toMatchObject({ devices: true });
    expect(health).toHaveProperty("forecast_12h");
  });
});
