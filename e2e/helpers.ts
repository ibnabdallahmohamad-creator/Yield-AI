import { expect, type Page } from "@playwright/test";

/** Signs in with the built-in demo account and waits until the app has sent us on to `next`. */
export async function signIn(page: Page, next = "/dashboard"): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: /try the demo account/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Creates a fresh account (it lands on Farms & devices, empty). */
export async function signUp(page: Page, name = "Test Farmer"): Promise<string> {
  const email = `farmer-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/dashboard\/setup/);
  return email;
}

/** Fills the "Add your farm" form and outlines a small field on the map. */
export async function addFarm(page: Page, name: string): Promise<void> {
  await page.getByLabel("Farm name").fill(name);
  const map = page.locator(".leaflet-container").first();
  await expect(map).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Zoom in" }).first().click();
    await page.waitForTimeout(200);
  }
  const box = (await map.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const [dx, dy] of [
    [-80, -60],
    [80, -60],
    [80, 60],
    [-80, 60],
  ]) {
    await page.mouse.click(cx + dx, cy + dy);
    await page.waitForTimeout(100);
  }
  await expect(page.getByText(/4 corners · [\d.,]+ ha/)).toBeVisible();
  await page.getByRole("button", { name: "Save farm" }).click();
}

/** Collects uncaught page errors; assert it is empty at the end of a test. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Answers come from the AI service, the LLM fallback or the offline engine, depending on the env. */
export const ANSWER_SOURCE = /Yield AI model|Claude · LLM fallback|Built-in agronomy engine/;
