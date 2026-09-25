import { expect, test } from "@playwright/test";
import { measureClutter, settle, signIn } from "./helpers";

/**
 * The clutter budget (ui_improvement §2.4), checked on the first screen. The full budget applies to
 * Home and the assistant, the two pages people land on; the evidence pages (the Plan, a farm's
 * workspace) are lists of content, so there the type, touch-target and scroll rules apply.
 *
 * | Budget                           | Target                                   |
 * | Controls in first screen (desk)  | ≤ 15, the page's own (app chrome apart)   |
 * | Words in first screen            | ≤ 150, the page's own (app chrome apart)  |
 * | Distinct font sizes              | ≤ 6 (12 / 14 / 16 / 20 / 28 / 36)        |
 * | Text under 12 px                 | 0, except map attribution                |
 * | Phone touch targets              | ≥ 44×44 px                               |
 * | Scroll containers per page       | 1 (the page itself)                      |
 */
const ALLOWED_SIZES = [12, 14, 16, 20, 28, 36];

const PAGES = [
  { name: "home", path: "/dashboard", full: true },
  { name: "assistant", path: "/dashboard/assistant?farm=khor-north", full: true },
  { name: "plan", path: "/dashboard/insights", full: false },
  { name: "farm details", path: "/dashboard/farm/khor-north", full: false },
  { name: "land use", path: "/dashboard/land?farm=khor-north", full: false },
] as const;

for (const p of PAGES) {
  test(`${p.name} stays within the clutter budget`, async ({ page }, testInfo) => {
    const phone = testInfo.project.name === "mobile";
    await signIn(page, p.path);
    await settle(page);
    const m = await measureClutter(page);
    const report = JSON.stringify(m, null, 1);

    expect(m.fontSizes.every((s) => ALLOWED_SIZES.includes(s)), `font sizes ${m.fontSizes}\n${report}`).toBe(true);
    expect(m.fontSizes.length, report).toBeLessThanOrEqual(6);
    expect(m.tinyText, report).toEqual([]);
    expect(m.scrollers, report).toEqual([]);
    expect(m.horizontalOverflow, report).toBe(0);
    if (phone) {
      expect(m.smallTargets, report).toEqual([]);
    } else if (p.full) {
      expect(m.controls.length, report).toBeLessThanOrEqual(15);
    }
    if (p.full) expect(m.words, report).toBeLessThanOrEqual(150);
  });
}
