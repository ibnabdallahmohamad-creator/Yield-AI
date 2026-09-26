import { expect, test } from "@playwright/test";
import { collectPageErrors } from "./helpers";

/** The demo-day account: username "Tester", password "Tester", three farms with live test probes. */
test.describe("Tester account", () => {
  test.setTimeout(180_000);

  test("signs in with the username and sees its farms, probes and the model's analysis", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/login");
    await page.getByLabel("Email or username").fill("Tester");
    await page.getByLabel("Password").fill("Tester");
    await page.getByRole("button", { name: /^Sign in/ }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), { timeout: 120_000 });

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tester");
    const farms = ["Al Khor Tomato Farm", "Umm Salal Cucumber Greenhouses", "Al Sheehaniya Alfalfa Field"];
    for (const name of farms) await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();

    // The test probes are paired and reporting.
    await page.goto("/dashboard/devices");
    await expect(page.getByText(/3 farms · 9 devices · 9 online/)).toBeVisible({ timeout: 30_000 });

    // AI analysis: the model's output format, from the nine inputs it was trained on.
    await page.getByRole("link", { name: /Al Khor Tomato Farm/ }).first().click();
    await page.getByRole("tab", { name: "AI analysis" }).click();
    await expect(page.getByText("What the model read")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/soil moisture/i).first()).toBeVisible();
    await expect(page.getByText(/Answer/).first()).toBeVisible();

    const res = await page.request.get(`/api/analysis?farm=${encodeURIComponent(new URL(page.url()).pathname.split("/").pop()!)}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { input: { inputs: Record<string, unknown> }; output: { summary: string } };
    expect(Object.keys(body.input.inputs)).toHaveLength(9);
    expect(body.output.summary.length).toBeGreaterThan(20);

    expect(errors).toEqual([]);
  });

  test("a wrong password is refused with a clear message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill("Tester");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: /^Sign in/ }).click();
    await expect(page.getByText(/don't match an account/)).toBeVisible({ timeout: 30_000 });
  });
});
