import { expect, test } from "@playwright/test";
import { collectPageErrors } from "./helpers";

test.describe("landing page", () => {
  test("hero, three demo widgets and how it works", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every field, every probe, one clear next step.");
    await expect(page.getByRole("link", { name: /open dashboard/i }).first()).toHaveAttribute("href", "/dashboard");
    for (const name of ["Farm map", "Soil trends", "Ask the agronomist"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    for (const step of ["Probe", "Map", "AI insight", "Action"]) {
      await expect(page.locator("#how-it-works").getByRole("heading", { name: step, exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("clicking a farm on the mini map shows its risk and top insight", async ({ page }) => {
    await page.goto("/");
    const map = page.getByRole("region", { name: "Farm map" });
    await map.getByTitle(/^Al Shamal East Farm:/).click();
    const card = map.locator("[aria-live=polite]");
    await expect(card).toContainText("Al Shamal East Farm");
    await expect(card).toContainText(/low risk/i);
    await expect(card.getByRole("link", { name: /open in dashboard/i })).toHaveAttribute("href", "/dashboard?farm=shamal-east");
  });

  test("the mini chart toggles between salinity, moisture and pH", async ({ page }) => {
    await page.goto("/");
    const chart = page.getByRole("region", { name: "Soil trends" });
    await expect(chart.getByRole("img", { name: /^Salinity \(ECe\) for .*, last 30 days$/ })).toBeVisible();
    await chart.getByRole("radio", { name: "Moisture" }).click();
    await expect(chart.getByRole("img", { name: /^Soil moisture for / })).toBeVisible();
    await chart.getByRole("radio", { name: "pH" }).click();
    await expect(chart.getByRole("img", { name: /^Soil pH for / })).toBeVisible();
  });

  test("a preset question in the mini chat types out an answer", async ({ page }) => {
    await page.goto("/");
    const chat = page.getByRole("region", { name: "Ask the agronomist" });
    const chips = chat.getByRole("button", { name: /\?$/ });
    await expect(chips).toHaveCount(3);
    const question = (await chips.first().textContent())?.trim() ?? "";
    await chips.first().click();
    const log = chat.getByRole("log");
    await expect(log).toContainText(question);
    await expect(log.getByText("Built-in agronomy engine")).toBeVisible({ timeout: 30_000 });
  });
});
