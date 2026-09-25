import { expect, test, type APIRequestContext } from "@playwright/test";
import { addFarm, collectPageErrors, signUp } from "./helpers";

/** What the ESP32 firmware sends. */
async function post(request: APIRequestContext, key: string | null, data: object) {
  const res = await request.post("/api/readings", {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    data,
  });
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> };
}

const reading = (moisture: number) => ({ moisture, temperature: 29.1, ec_us_cm: 1720, ph: 7.9, n: 30, p: 18, k: 140, rssi: -62, fw: "1.0.0" });

test.describe("a real account and its ESP32", () => {
  test("starts empty, adds a farm, connects an ESP32 over Wi-Fi and sees its readings", async ({ page, request }) => {
    const errors = collectPageErrors(page);
    await signUp(page, "Fatima Al-Kuwari");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Fatima");
    // No demo farms for a real account: the dashboard sends it back to setup.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/setup/);

    await addFarm(page, "Al Khor Test Farm");
    await expect(page.getByRole("heading", { name: "Al Khor Test Farm" })).toBeVisible();
    await page.getByRole("button", { name: "Register ESP32" }).click();
    const key = (await page.getByTestId("device-key").textContent())!.trim();
    expect(key).toMatch(/^yai_/);
    await expect(page.getByText("Waiting for the first signal from your ESP32…")).toBeVisible();

    // The device checks in, then reports; the reply tells it the reading interval.
    const heartbeat = await post(request, key, { rssi: -60, fw: "1.0.0" });
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.interval_s).toBe(10);
    await page.waitForTimeout(2100);
    const first = await post(request, key, reading(12.4));
    expect(first.body).toMatchObject({ ok: true, stored: 1, interval_s: 10 });
    await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("link", { name: /open dashboard/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Khor Test Farm");
    await expect(page.getByRole("list", { name: "Farms ranked by risk" }).getByRole("button")).toHaveCount(1);
    const devices = page.getByRole("region", { name: "Devices" });
    await expect(devices).toContainText("Online");
    await expect(devices).toContainText("12.4 %");

    // Live updates are on for accounts: a new reading shows up without reloading.
    await page.waitForTimeout(2100);
    await post(request, key, reading(13.7));
    await expect(devices).toContainText("13.7 %", { timeout: 20_000 });

    await page.getByRole("tab", { name: "Readings" }).click();
    await expect(page.getByText(/\d+ readings from 1 probe in the last 24 hours/)).toBeVisible();
    await expect(page.getByRole("img", { name: /^Soil moisture per probe/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the reading interval chosen in the app reaches the device", async ({ page, request }) => {
    await signUp(page);
    await addFarm(page, "Interval Farm");
    await page.getByRole("button", { name: "Register ESP32" }).click();
    const key = (await page.getByTestId("device-key").textContent())!.trim();

    await page.getByRole("region", { name: /reading interval/i }).getByRole("combobox", { name: "Reading interval" }).click();
    await page.getByRole("option", { name: "Every 30 s" }).click();
    await expect(page.getByText(/send a reading every 30 s/)).toBeVisible();
    await page.waitForTimeout(500);

    const res = await post(request, key, reading(11));
    expect(res.body.interval_s).toBe(30);
  });

  test("accounts never see each other's farms, and devices need their key", async ({ browser, request }) => {
    const alice = await browser.newPage();
    await signUp(alice, "Alice");
    await addFarm(alice, "Alice Farm");
    await alice.getByRole("button", { name: "Register ESP32" }).click();
    await expect(alice.getByTestId("device-key")).toBeVisible();
    await alice.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(alice.getByRole("heading", { level: 1 })).toHaveText("Alice Farm");
    const farmId = new URL(alice.url()).searchParams.get("farm");
    expect(farmId).toBeTruthy();

    const bob = await browser.newPage();
    await signUp(bob, "Bob");
    await expect(bob.getByText("Alice Farm")).toHaveCount(0);
    await bob.goto(`/dashboard/farm/${farmId}`);
    await expect(bob.getByRole("heading", { name: "This field is not on our map" })).toBeVisible();

    expect((await post(request, null, reading(10))).status).toBe(401);
    expect((await post(request, "yai_not-a-real-device-key", reading(10))).status).toBe(401);
  });
});
