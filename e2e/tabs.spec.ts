import { expect, test } from "@playwright/test";
import { collectPageErrors, signIn } from "./helpers";

test.describe("dashboard tabs", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("weather: the next 12 hours with a map, advice, charts and an hourly table", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.getByRole("tab", { name: "Weather" }).click();
    await expect(page).toHaveURL(/tab=weather/);
    await expect(page.getByRole("heading", { name: /^Weather · next 12 hours at / })).toBeVisible();
    await expect(page.getByText(/refreshes every 12 hours/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Air temperature map" }).locator(".leaflet-container")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^What it means for / })).toBeVisible();
    await expect(page.getByRole("img", { name: "Temperature for the next 12 hours" })).toBeVisible();
    await expect(page.getByRole("table", { name: /^Hourly forecast for the next 12 hours/ }).locator("tbody tr")).toHaveCount(12);
    await expect(page.getByRole("heading", { name: "Your farms, next 12 hours" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("temperature, humidity, rain and wind each have their map and charts", async ({ page }) => {
    const views: Array<[string, string, RegExp]> = [
      ["Temperature", "Air temperature map", /^Air temperature for the next/],
      ["Humidity", "Relative humidity map", /^Vapour pressure deficit for the next/],
      ["Rain", "Rain map", /^Chance of rain for the next/],
      ["Wind", "Wind speed map", /^Wind speed and gusts for the next/],
    ];
    for (const [tab, map, chart] of views) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("region", { name: map }).locator(".leaflet-container")).toBeVisible();
      await expect(page.getByRole("img", { name: chart })).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /^Wind rose:/ })).toBeVisible();
    // Stepping through the hours moves the map.
    await page.getByRole("slider", { name: "Forecast hour" }).press("End");
    await expect(page.getByRole("slider", { name: "Forecast hour" })).toHaveAttribute("aria-valuetext", /in 11 hours$/);
  });

  test("readings: every probe over any range, as a chart, small multiples or a table", async ({ page }) => {
    await page.getByRole("tab", { name: "Readings" }).click();
    await expect(page.getByText(/readings from \d probes in the last 7 days/)).toBeVisible();
    await expect(page.getByRole("img", { name: "Soil moisture per probe, last 7 days" })).toBeVisible();
    await page.getByRole("radio", { name: "Last 30 days" }).click();
    await expect(page.getByRole("img", { name: "Soil moisture per probe, last 30 days" })).toBeVisible();
    await page.getByRole("radio", { name: "All readings" }).click();
    await expect(page.getByRole("img", { name: /farm mean and probe range$/ })).toHaveCount(10);
    await page.getByRole("radio", { name: "Table" }).click();
    await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/-readings-30d\.csv$/);
  });

  test("AI insights: the model's analysis split into sections, plus the numbers behind it", async ({ page }) => {
    await page.getByRole("tab", { name: "AI insights" }).click();
    await expect(page.getByRole("heading", { name: "Key findings" })).toBeVisible();
    const analysis = page.getByRole("region", { name: "Farm analysis" });
    await expect(analysis.getByRole("region", { name: "Summary" })).toBeVisible({ timeout: 45_000 });
    await expect(analysis.getByRole("region", { name: "Irrigation" })).toBeVisible();
    await expect(analysis.getByRole("region", { name: /^Weather/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Salinity outlook/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Probe agreement" })).toBeVisible();
  });
});
