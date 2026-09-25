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

export interface Clutter {
  /** Interactive elements of the page itself in the first screen (Leaflet's own zoom buttons and pins, and the app chrome, excluded). */
  controls: string[];
  /** Interactive elements of the app chrome (`[data-chrome]`: sidebar, header, tab bar), the same on every page. */
  chromeControls: string[];
  /** Controls whose touch target (the control, or the label wrapping it) is under 44×44 px. */
  smallTargets: string[];
  /** Words of the page itself (the app chrome excluded). */
  words: number;
  fontSizes: number[];
  /** Text under 12 px (map attribution excepted). */
  tinyText: string[];
  /** Scrolling elements besides the page itself. */
  scrollers: string[];
  horizontalOverflow: number;
}

/**
 * Measures the first screen against the clutter budget (ui_improvement §2.4). Leaflet's internal
 * controls are left out: they're part of the map widget, drawn by the library at its own sizes.
 * The app chrome (`[data-chrome]`) is counted apart from the page's own controls and words, since
 * it is learned once and identical everywhere; the type, touch-target and scroll rules cover both.
 */
export async function measureClutter(page: Page): Promise<Clutter> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    };
    const inMapWidget = (el: Element) => Boolean(el.closest(".leaflet-control-container, .leaflet-marker-pane, .leaflet-overlay-pane"));
    const inChrome = (el: Element) => Boolean(el.closest("[data-chrome]"));
    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    };

    const allControls = [
      ...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="slider"], [role="combobox"], [role="radio"]'),
      // Hidden form mirrors (e.g. Radix Select's native <select>) aren't controls anyone uses.
    ].filter((el) => visible(el) && inView(el) && !inMapWidget(el) && !el.closest('[aria-hidden="true"]'));
    const controls = allControls.filter((el) => !inChrome(el));
    const chromeControls = allControls.filter(inChrome);

    /** The area that takes the tap: a stretched link's ::after covers its nearest positioned ancestor. */
    const hitBox = (el: Element) => {
      const after = getComputedStyle(el, "::after");
      if (after.position === "absolute" && after.content !== "none" && after.top === "0px" && after.left === "0px") {
        let p = el.parentElement;
        while (p && getComputedStyle(p).position === "static") p = p.parentElement;
        if (p) return p.getBoundingClientRect();
      }
      return el.getBoundingClientRect();
    };
    const smallTargets = allControls.filter((el) => {
      const own = hitBox(el);
      const label = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      const box = label ? label.getBoundingClientRect() : own;
      return Math.max(own.width, box.width) < 44 || Math.max(own.height, box.height) < 44;
    });

    const texts = [...document.querySelectorAll("body *")].filter(
      (el) => visible(el) && inView(el) && !el.closest(".leaflet-control-container") && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()),
    );
    const sizes = new Set<number>();
    const tinyText: string[] = [];
    let words = 0;
    for (const el of texts) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      sizes.add(size);
      if (size < 12) tinyText.push(`${size}px: ${el.textContent?.trim().slice(0, 40)}`);
      // Chrome is counted apart; map pins' labels belong to the map widget, like its controls.
      if (inChrome(el) || inMapWidget(el)) continue;
      for (const n of el.childNodes) if (n.nodeType === 3) words += (n.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
    }

    const scrollers = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const s = getComputedStyle(el);
        return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2 && visible(el);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);

    return {
      controls: controls.map(describe),
      chromeControls: chromeControls.map(describe),
      smallTargets: smallTargets.map(describe),
      words,
      fontSizes: [...sizes].sort((a, b) => a - b),
      tinyText,
      scrollers,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
    };
  });
}

/** Lets the map tiles, charts and fonts settle before measuring or screenshotting. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}
