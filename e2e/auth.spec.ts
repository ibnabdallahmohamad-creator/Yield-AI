import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("accounts", () => {
  test("the dashboard needs an account", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(page.getByRole("button", { name: /try the demo account/i })).toBeVisible();
  });

  test("a deep link to a farm and layer survives signing in", async ({ page }) => {
    await page.goto("/dashboard?farm=shamal-east&layer=moisture");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByRole("button", { name: /try the demo account/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Shamal East Farm");
    // The old overview link now opens the farm's workspace, keeping the layer.
    await expect(page).toHaveURL(/\/dashboard\/farm\/shamal-east\?layer=moisture/);
    await expect(page.getByRole("combobox", { name: "Map layer" })).toContainText("Soil moisture");
  });

  test("signing out returns to the home page and locks the dashboard", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
