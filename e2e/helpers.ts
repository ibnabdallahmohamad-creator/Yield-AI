import { expect, type Page } from "@playwright/test";

/** Signs in with the built-in demo account and waits until the app has sent us on to `next`. */
export async function signIn(page: Page, next = "/dashboard"): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: /try the demo account/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Collects uncaught page errors; assert it is empty at the end of a test. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Answers come from the AI service, the LLM fallback or the offline engine, depending on the env. */
export const ANSWER_SOURCE = /Yield AI model|Claude · LLM fallback|Built-in agronomy engine/;
