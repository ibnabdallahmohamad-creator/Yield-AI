import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors } from "./helpers";

async function signUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await page.getByRole("textbox", { name: /name/i }).fill("Test Grower");
  await page.getByRole("textbox", { name: /email/i }).fill(`grower-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`);
  await page.getByRole("textbox", { name: "Password" }).fill("harvest-2026-secure");
  await page.getByRole("button", { name: /create account|sign up/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe("your own farms", () => {
  test("a new account starts empty, adds a farm with a pin and places sensors", async ({ page }) => {
    const errors = collectPageErrors(page);
    await signUp(page);

    // Empty to begin with — none of the demo farms.
    await expect(page.getByRole("heading", { name: "Add your first farm" })).toBeVisible();
    await expect(page.getByText("Al Khor North Farm")).toHaveCount(0);

    // Add a farm: type the pin's coordinates, check the land profile, drop the pin elsewhere by clicking.
    await page.getByRole("link", { name: /add a farm/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/farms\/new$/);
    await page.getByLabel("Farm name").fill("Green Valley Farm");
    await page.getByLabel("Latitude").fill("25.7481");
    await page.getByLabel("Longitude").fill("51.3725");
    const land = page.locator("section[aria-label='Land profile']");
    await expect(land).toContainText("Al Khor & Al Thakhira");
    await expect(land).toContainText("Fertility");
    await expect(land).toContainText("Groundwater");
    const map = page.locator(".leaflet-container").first();
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + 15, box.y + box.height / 2 + 15);
    await expect(page.getByLabel("Latitude")).not.toHaveValue("25.7481");
    await page.getByRole("button", { name: /save farm/i }).click();

    // Sensors: one by typed coordinates, one by clicking the map.
    await expect(page).toHaveURL(/\/sensors\?new=1$/);
    await expect(page.getByText(/Farm saved/)).toBeVisible();
    await page.getByLabel(/Location \(latitude, longitude\)/).fill("25.7483, 51.3727");
    await page.getByLabel("Label").fill("North block");
    await page.getByRole("button", { name: "Add sensor" }).click();
    await expect(page.getByText(/Sensor GVF-[A-Z0-9]{4}-01 added/)).toBeVisible();
    const sensorMap = (await page.locator(".leaflet-container").first().boundingBox())!;
    await page.mouse.click(sensorMap.x + sensorMap.width / 2 - 25, sensorMap.y + sensorMap.height / 2 + 20);
    await page.getByRole("button", { name: "Add sensor" }).click();
    await expect(page.getByText(/Sensor GVF-[A-Z0-9]{4}-02 added/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sensors (2)" })).toBeVisible();

    // The dashboard now shows only this farm, waiting for its first readings.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Green Valley Farm");
    await expect(page.getByText("No probe readings yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weather" })).toBeVisible();
    await expect(page.locator("section[aria-label='Land profile']")).toContainText("Atlas cell QA-R");

    // The assistant answers from the land atlas before any readings arrive.
    const input = page.getByPlaceholder(/Ask about Green Valley Farm/);
    await input.fill("How fertile is the land here?");
    await input.press("Enter");
    await expect(page.locator("aside[aria-label='AI agronomist']")).toContainText(/Fertility is|atlas cell/i, { timeout: 30_000 });

    expect(errors).toEqual([]);
  });

  test("the land atlas describes any 10 km² cell", async ({ page }) => {
    await signUp(page);
    await page.goto("/dashboard/land?cell=QA-R45-C21");
    await expect(page.getByRole("heading", { name: "QA-R45-C21" })).toBeVisible();
    const land = page.locator("section[aria-label='Land profile']");
    await expect(land).toContainText("Limestone plain with rawdat depressions");
    await expect(land).toContainText("What it can grow");
    await land.getByRole("button", { name: /full description/i }).click();
    await expect(land).toContainText("Mamoon & Rahman (2017)");
  });

  test("the demo account keeps its demo farms and is read-only", async ({ page }) => {
    await page.goto("/login?next=%2Fdashboard%2Ffarms%2Fnew");
    await page.getByRole("button", { name: /try the demo account/i }).click();
    await expect(page.getByText(/The demo account is read-only/)).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Add your first farm");
  });
});
