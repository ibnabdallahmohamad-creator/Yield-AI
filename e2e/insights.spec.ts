import { expect, test } from "@playwright/test";
import { collectPageErrors, signIn } from "./helpers";

test.describe("plan", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "/dashboard/insights");
  });

  test("this week's actions come most urgent first, grouped by farm", async ({ page }) => {
    const errors = collectPageErrors(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan");
    const week = page.getByRole("region", { name: "This week" });
    const groups = week.getByRole("region");
    await expect(groups.first()).toHaveAccessibleName(/^Do first: \d+ actions?$/);
    // The riskiest farm's actions lead.
    await expect(groups.first().getByRole("link").first()).toHaveText("Al Shamal Greenhouses");

    const total = Number((await page.getByText(/^\d+ actions? across/).textContent())?.match(/^\d+/)?.[0]);
    const showAll = week.getByRole("button", { name: `Show all ${total} actions` });
    await showAll.click();
    await expect(week.getByRole("button", { name: "Why" })).toHaveCount(total);
    await week.getByRole("button", { name: "Show fewer" }).click();
    expect(errors).toEqual([]);
  });

  test("ticking an action off moves it to Done and lowers the Plan badge", async ({ page }) => {
    const week = page.getByRole("region", { name: "This week" });
    const badge = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Plan/ });
    const count = async () => Number((await badge.innerText()).match(/(\d+)\s*$/)?.[1] ?? 0);
    const before = await count();
    const first = week.getByRole("checkbox").first();
    await first.click();
    await expect(first).toHaveAttribute("aria-checked", "true");
    await expect.poll(count).toBe(before - 1);
    await expect(page.getByText(/ · 1 done/)).toBeVisible();

    // Next visit: the ticked action waits under Done, and can be unticked there.
    await page.reload();
    const done = week.getByRole("button", { name: "Done · 1" });
    await done.click();
    await week.getByRole("checkbox", { checked: true }).click();
    await expect(done).toBeHidden();
    await expect.poll(count).toBe(before);
  });

  test("Why opens the reasoning, the method and the chart behind an action", async ({ page }) => {
    const first = page.getByRole("region", { name: "This week" }).getByRole("listitem").first();
    const why = first.getByRole("button", { name: "Why" });
    await why.click();
    await expect(why).toHaveAttribute("aria-expanded", "true");
    await expect(first.getByText(/^Method: /)).toBeVisible();
    await expect(first.getByRole("link", { name: "See the chart" })).toHaveAttribute("href", /\/dashboard\/farm\/[\w-]+\?tab=trends&chart=\w+/);
    await first.getByRole("link", { name: "See the chart" }).click();
    await expect(page.getByRole("tablist", { name: "Farm details" }).getByRole("tab", { name: "Trends" })).toHaveAttribute("aria-selected", "true");
  });

  test("the irrigation schedule sits beside the actions", async ({ page }) => {
    const water = page.getByRole("region", { name: "Irrigation" });
    await expect(water.getByRole("listitem").first()).toContainText(/Now|Today|Tomorrow/);
    await expect(water).toContainText(/\d+ mm/);
  });

  test("the plan narrows to one farm, which links to its full assessment", async ({ page }) => {
    await page.getByRole("combobox", { name: "Show advice for" }).click();
    await page.getByRole("option", { name: "Al Khor North Farm" }).click();
    await expect(page).toHaveURL(/\/dashboard\/insights\?farm=khor-north/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan");
    await expect(page.getByText(/^\d+ actions? for Al Khor North Farm this week/)).toBeVisible();
    await page.getByRole("link", { name: "Full assessment" }).click();
    await expect(page).toHaveURL(/\/dashboard\/farm\/khor-north\?tab=advice/);
    await expect(page.getByRole("heading", { name: "Assessment" })).toBeVisible();
  });

  test("next season compares each farm's crop with what would grow better", async ({ page }) => {
    await page.getByRole("navigation", { name: "Plan view" }).getByRole("link", { name: "Next season" }).click();
    await expect(page).toHaveURL(/view=season/);
    const season = page.getByRole("region", { name: "Next season" });
    await expect(season.getByRole("row")).toHaveCount(9);
    await expect(season).toContainText(/\w+ · keep/);
    await expect(season).toContainText(/ then \w+/);
  });

  test("How it works explains the risk score", async ({ page }) => {
    await page.getByRole("button", { name: "How it works" }).click();
    const drawer = page.getByRole("dialog", { name: "How the advice works" });
    await expect(drawer).toContainText("product heuristic");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});
