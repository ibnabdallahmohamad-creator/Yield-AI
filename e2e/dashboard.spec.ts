import { expect, test } from "@playwright/test";
import { ANSWER_SOURCE, collectPageErrors, signIn } from "./helpers";

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("farms are ranked by risk and selecting one updates the page", async ({ page }) => {
    const errors = collectPageErrors(page);
    const list = page.getByRole("list", { name: "Farms ranked by risk" });
    const farms = list.getByRole("button");
    await expect(farms).toHaveCount(8);
    await expect(farms.first()).toHaveAttribute("aria-current", "true");

    // Demo data: the two farms with rising salinity and the one drying out are the high-risk three.
    const top3 = (await farms.allTextContents()).slice(0, 3).join(" | ");
    for (const name of ["Al Shamal Greenhouses", "Al Khor North Farm", "Al Sheehaniya West Farm"]) {
      expect(top3).toContain(name);
    }

    await list.getByRole("button", { name: /Al Shamal East Farm/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Shamal East Farm");
    await expect(page).toHaveURL(/farm=shamal-east/);
    expect(errors).toEqual([]);
  });

  test("the layer switcher recolours the map and updates the chart", async ({ page }) => {
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.getByRole("radio", { name: "Water deficit" }).click();
    await expect(page).toHaveURL(/layer=deficit/);
    await expect(page.getByRole("img", { name: /^Water deficit colour scale/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Water deficit for / })).toBeVisible();
    await page.getByRole("radio", { name: "NPK nutrients" }).click();
    await page.getByRole("radio", { name: "Potassium" }).click();
    await expect(page).toHaveURL(/layer=k$/);
  });

  test("the assistant answers a preset question", async ({ page }) => {
    const panel = page.getByRole("complementary", { name: "AI agronomist" });
    await panel.getByRole("button", { name: "How much should I irrigate?" }).click();
    const log = panel.getByRole("log");
    await expect(log).toContainText("How much should I irrigate?");
    await expect(log.getByText(ANSWER_SOURCE)).toBeVisible({ timeout: 45_000 });
    await expect(log).toContainText(/\d+ mm/);
  });

  test("compare mode shows then and now side by side with a change per farm", async ({ page }) => {
    await page.getByRole("switch", { name: "Compare" }).click();
    await expect(page.getByText(/^Then · /)).toBeVisible();
    await expect(page.getByText(/^Now · /)).toBeVisible();
    await expect(page.locator(".leaflet-container")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Farms ranked by risk" })).toContainText(/[+−]\d+%/);
  });

  test("live mode polls for new readings", async ({ page }) => {
    await page.getByRole("switch", { name: "Live" }).click();
    await expect(page.locator("header").getByText(/probes? · \d{2}:\d{2}:\d{2}/)).toBeVisible({ timeout: 30_000 });
  });

  test("the details page covers every layer, the probes and the agronomy inputs", async ({ page }) => {
    const name = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
    await page.getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(/\/dashboard\/farm\/[\w-]+\?layer=ece$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("img", { name: new RegExp(`for ${name}, last 30 days$`) })).toHaveCount(11);
    await expect(page.getByRole("table")).toContainText("Saltiest");
    await expect(page.getByRole("heading", { name: "Agronomy inputs" })).toBeVisible();
    await expect(page.getByText("LR = ECw / (5 ECe − ECw), FAO-29 Eq. 7", { exact: false })).toBeVisible();

    await page.getByRole("link", { name: "All farms" }).click();
    await expect(page).toHaveURL(/\/dashboard\?farm=/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  });

  test("an unknown farm shows the not-found page", async ({ page }) => {
    await page.goto("/dashboard/farm/no-such-farm");
    await expect(page.getByRole("heading", { name: "This field is not on our map" })).toBeVisible();
  });
});
