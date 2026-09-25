import { expect, test } from "@playwright/test";
import { ANSWER_SOURCE, signIn } from "./helpers";

const horizontalOverflow = () => document.documentElement.scrollWidth - window.innerWidth;

test.describe("on a phone", () => {
  test("the landing page fits the screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Farm map" })).toBeVisible();
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
  });

  test("home lists the farms; the farm switcher opens in a sheet; layers in a menu", async ({ page }) => {
    await signIn(page);
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
    await page.getByRole("list", { name: "Farms ranked by risk" }).getByRole("link", { name: "Al Khor North Farm" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Al Khor North Farm");
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: /^Switch farm/ }).click();
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

  test("the bottom tabs reach every section", async ({ page }) => {
    await signIn(page);
    const tabs = page.getByRole("navigation", { name: "Main" });
    await tabs.getByRole("link", { name: /^Plan/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan");
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
    await tabs.getByRole("link", { name: "Farm", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/farm\//);
    await tabs.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: /Land use/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Land use");
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
    await tabs.getByRole("link", { name: "Home" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good /);
    await tabs.getByRole("link", { name: /Ask AI/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/assistant/);
  });

  test("the assistant works full screen", async ({ page }) => {
    await signIn(page, "/dashboard/assistant?farm=khor-north");
    // The empty state starts at the top, not scrolled to the composer.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByRole("textbox").fill("How much should I irrigate?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(ANSWER_SOURCE)).toBeVisible({ timeout: 45_000 });
    expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.getByRole("navigation", { name: "Chat history" })).toContainText("How much should I irrigate?");
  });
});
