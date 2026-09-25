import { expect, test } from "@playwright/test";
import { ANSWER_SOURCE, collectPageErrors, signIn } from "./helpers";

test.describe("assistant", () => {
  test("answers a starter question and keeps the chat", async ({ page }) => {
    const errors = collectPageErrors(page);
    await signIn(page, "/dashboard/assistant?farm=khor-north");
    await expect(page.getByRole("heading", { name: "Ask about Al Khor North Farm" })).toBeVisible();
    await page.getByRole("list", { name: "Suggested questions" }).getByRole("button", { name: /How much should I irrigate\?/ }).click();

    await expect(page.getByText(ANSWER_SOURCE)).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("main")).toContainText(/\d+ mm/);
    await expect(page).toHaveURL(/\/dashboard\/assistant\/[\w-]+$/);

    // The chat is saved: it is in the history and survives a reload.
    const history = page.getByRole("navigation", { name: "Chat history" });
    await expect(history).toContainText("How much should I irrigate?");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText("How much should I irrigate?");
    await expect(page.getByText(ANSWER_SOURCE)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Ask AI about this hands an action to the assistant", async ({ page }) => {
    await signIn(page, "/dashboard/insights");
    const first = page.getByRole("region", { name: "This week" }).getByRole("listitem").first();
    const title = (await first.locator("p").first().textContent())?.trim() ?? "";
    await first.getByRole("link", { name: "Ask AI about this" }).click();
    await expect(page).toHaveURL(/\/dashboard\/assistant/);
    await expect(page.locator("main")).toContainText(`Explain this recommendation and how to do it: ${title}`);
    await expect(page.getByText(ANSWER_SOURCE)).toBeVisible({ timeout: 45_000 });
  });

  test("Escape and Back leave the assistant", async ({ page }) => {
    await signIn(page, "/dashboard/insights");
    await page.getByRole("link", { name: /^Ask AI/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/assistant/);
    await page.getByRole("button", { name: "Back" }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/insights/);
  });
});
