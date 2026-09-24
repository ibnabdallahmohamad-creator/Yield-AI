import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const horizontalOverflow = () => document.documentElement.scrollWidth - window.innerWidth;

test.describe("on a phone", () => {
  test("the landing page fits the screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Farm map" })).toBeVisible();
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
  });

  test("farms open in a sheet and layers in a menu", async ({ page }) => {
    await signIn(page);
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Farms", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Farms" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /Al Shamal East Farm/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Shamal East Farm");

    const layer = page.getByRole("combobox", { name: "Map layer" });
    await layer.click();
    await page.getByRole("option", { name: "Soil moisture" }).click();
    await expect(layer).toContainText("Soil moisture");
    await expect(page).toHaveURL(/layer=moisture/);
  });
});
