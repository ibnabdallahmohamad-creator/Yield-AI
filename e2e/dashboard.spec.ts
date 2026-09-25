import { expect, test } from "@playwright/test";
import { collectPageErrors, signIn } from "./helpers";

test.describe("home", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("ranks every farm by risk and opens one", async ({ page }) => {
    const errors = collectPageErrors(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening)/);
    await expect(page.getByRole("list", { name: "Summary" })).toContainText("need attention");

    // Demo data: the two farms with rising salinity and the one drying out are the high-risk three.
    const farms = page.getByRole("region", { name: "Farms" }).getByRole("link");
    await expect(farms).toHaveCount(8);
    const order = await farms.allTextContents();
    for (const name of ["Al Shamal Greenhouses", "Al Khor North Farm", "Al Sheehaniya West Farm"]) {
      expect(order.indexOf(name)).toBeLessThan(order.indexOf("Al Shamal East Farm"));
    }

    await farms.filter({ hasText: "Al Shamal East Farm" }).click();
    await expect(page).toHaveURL(/\/dashboard\/farm\/shamal-east$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Shamal East Farm");
    expect(errors).toEqual([]);
  });

  test("the do-first list opens a farm's advice", async ({ page }) => {
    const doFirst = page.getByRole("region", { name: "Do first this week" });
    await doFirst.getByRole("listitem").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/dashboard\/farm\/[\w-]+\?tab=advice/);
    await expect(page.getByRole("tablist", { name: "Farm details" }).getByRole("tab", { name: /Advice/ })).toHaveAttribute("aria-selected", "true");
  });

  test("old overview links open the farm's workspace", async ({ page }) => {
    await page.goto("/dashboard?farm=khor-north&layer=deficit");
    await expect(page).toHaveURL(/\/dashboard\/farm\/khor-north\?layer=deficit/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Khor North Farm");
  });
});

test.describe("farm workspace", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "/dashboard/farm/shamal-greenhouses");
  });

  test("the sidebar and the farm switcher change farm, keeping the tab", async ({ page }) => {
    const errors = collectPageErrors(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Shamal Greenhouses");
    const tabs = page.getByRole("tablist", { name: "Farm details" });
    await tabs.getByRole("tab", { name: "Trends" }).click();
    await expect(page).toHaveURL(/tab=trends/);

    await page.getByRole("button", { name: /^Switch farm/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Al Khor North Farm/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Khor North Farm");
    await expect(page).toHaveURL(/\/dashboard\/farm\/khor-north\?tab=trends/);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Al Shamal East Farm/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Shamal East Farm");
    expect(errors).toEqual([]);
  });

  test("the map layer and the chart tab follow each other", async ({ page }) => {
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.getByRole("combobox", { name: "Map layer" }).click();
    await page.getByRole("option", { name: "Water deficit" }).click();
    await expect(page).toHaveURL(/layer=deficit/);
    await expect(page.getByRole("img", { name: /^Water deficit colour scale/ })).toBeVisible();

    const charts = page.getByRole("tablist", { name: "Soil and weather charts" });
    await expect(charts.getByRole("tab", { name: /Moisture/ })).toHaveAttribute("aria-selected", "true");

    await charts.getByRole("tab", { name: /Salinity/ }).click();
    await expect(page).toHaveURL(/chart=salinity/);
    await expect(page.getByRole("combobox", { name: "Map layer" })).toContainText("Salinity");
  });

  test("What to do leads to all the advice and to the assistant", async ({ page }) => {
    const card = page.getByRole("region", { name: "What to do" });
    await expect(card).toContainText(/Do first|This week|When you can/);
    await card.getByRole("button", { name: /All \d+ actions/ }).click();
    await expect(page).toHaveURL(/tab=advice/);
    await expect(page.getByRole("heading", { name: "Assessment" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ask AI to plan the week" })).toHaveAttribute("href", /\/dashboard\/assistant\?farm=shamal-greenhouses/);
  });

  test("history compares two days side by side", async ({ page }) => {
    await page.getByRole("button", { name: "History" }).click();
    const history = page.getByRole("region", { name: "History" });
    await history.getByRole("switch", { name: "Compare" }).click();
    await expect(page.getByText(/^Then · /)).toBeVisible();
    await expect(page.getByText(/^Now · /)).toBeVisible();
    await expect(page.locator(".leaflet-container")).toHaveCount(2);
    await history.getByRole("button", { name: "Close history" }).click();
    await expect(page.locator(".leaflet-container")).toHaveCount(1);
  });

  test("live updates can be switched on from the map options", async ({ page }) => {
    await page.getByRole("button", { name: /^Map options/ }).click();
    await page.getByRole("switch", { name: /Live updates/ }).click();
    await expect(page.getByRole("button", { name: "Data status: Live" })).toBeVisible({ timeout: 30_000 });
  });

  test("tabs for today, advice, trends, probes and method", async ({ page }) => {
    const errors = collectPageErrors(page);
    const tabs = page.getByRole("tablist", { name: "Farm details" });
    await expect(page.getByRole("group", { name: "Headline numbers" })).toBeVisible();

    await tabs.getByRole("tab", { name: /Advice/ }).click();
    await expect(page).toHaveURL(/tab=advice/);
    for (const name of ["Warnings", "Insights", "Economic analysis", "Harvest & next crop", "Location"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }

    await tabs.getByRole("tab", { name: "Trends" }).click();
    await expect(page).toHaveURL(/tab=trends/);
    await expect(page.getByRole("img", { name: /Al Shamal Greenhouses/ }).first()).toBeVisible();

    await tabs.getByRole("tab", { name: "Probes" }).click();
    await expect(page.getByRole("table")).toContainText("Saltiest");

    await tabs.getByRole("tab", { name: "Method" }).click();
    await page.getByRole("button", { name: "Agronomy inputs" }).click();
    await expect(page.getByText("LR = ECw / (5 ECe − ECw), FAO-29 Eq. 7", { exact: false })).toBeVisible();

    await tabs.getByRole("tab", { name: "Today" }).click();
    await expect(page).toHaveURL(/\/dashboard\/farm\/shamal-greenhouses$/);
    expect(errors).toEqual([]);
  });

  test("old tab names still work", async ({ page }) => {
    await page.goto("/dashboard/farm/khor-north?tab=readings");
    const tabs = page.getByRole("tablist", { name: "Farm details" });
    await expect(tabs.getByRole("tab", { name: "Probes" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/\d+ readings from \d+ probes?/)).toBeVisible();
    await page.goto("/dashboard/farm/khor-north?tab=overview");
    await expect(tabs.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
  });

  test("an unknown farm shows the not-found page", async ({ page }) => {
    await page.goto("/dashboard/farm/no-such-farm");
    await expect(page.getByRole("heading", { name: "This field is not on our map" })).toBeVisible();
  });
});
