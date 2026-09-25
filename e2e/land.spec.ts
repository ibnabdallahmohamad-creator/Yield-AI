import { expect, test } from "@playwright/test";
import { collectPageErrors, signIn } from "./helpers";

test.describe("land use", () => {
  test("ranks what a farm's land could be used for", async ({ page }) => {
    const errors = collectPageErrors(page);
    await signIn(page, "/dashboard/land?farm=khor-north");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Land use");
    await expect(page.getByRole("region", { name: "Best use for this land" })).toBeVisible();

    const options = page.getByRole("region", { name: "All options, best first" });
    await expect(options.getByRole("button")).toHaveCount(8);
    await options.getByRole("button").first().click();
    await expect(options.getByText("National goal", { exact: true })).toBeVisible();

    const site = page.getByRole("region", { name: "Site" });
    await expect(site).toContainText("25.7470° N, 51.3732° E");
    await expect(site).toContainText("Al Khor");
    await expect(page.getByRole("region", { name: "Qatar's 2030 food goals" }).getByRole("rowheader").first()).toHaveText("Table eggs");
    expect(errors).toEqual([]);
  });

  test("analyses any point in Qatar and explains what can't work", async ({ page }) => {
    await signIn(page, "/dashboard/land");
    await page.getByLabel("Latitude").fill("25.30");
    await page.getByLabel("Longitude").fill("51.10");
    await page.getByLabel("Water EC (dS/m)").fill("7.9");
    await page.getByRole("button", { name: "Analyse land" }).click();
    await expect(page.getByRole("region", { name: "Site" })).toContainText("Al Sheehaniya", { timeout: 90_000 });
    const options = page.getByRole("region", { name: "All options, best first" });
    await expect(options.getByRole("button", { name: /Table eggs.*Not suitable/ })).toBeVisible();
  });

  test("rejects a point outside Qatar", async ({ page }) => {
    await signIn(page, "/dashboard/land");
    await page.getByLabel("Latitude").fill("24.0");
    await page.getByLabel("Longitude").fill("51.0");
    await page.getByRole("button", { name: "Analyse land" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "isn't in Qatar" })).toBeVisible();
  });

  test("a farm's advice links its location to the land-use advisor", async ({ page }) => {
    await signIn(page, "/dashboard/farm/khor-north?tab=advice");
    for (const name of ["Warnings", "Insights", "Economic analysis", "Harvest & next crop", "Location"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await page.getByRole("link", { name: "What else could this land grow?" }).click();
    await expect(page).toHaveURL(/\/dashboard\/land\?farm=khor-north/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Land use");
  });
});
