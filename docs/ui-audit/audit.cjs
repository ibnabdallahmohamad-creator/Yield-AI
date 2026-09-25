// UI audit: screenshots + clutter metrics for every Yield AI page.
// Usage (dev server running, demo data): node docs/ui-audit/audit.cjs  → docs/ui-audit/after/
// docs/ui-audit/shots/ keeps the "before" audit that ui_improvement.md links to (AUDIT_OUT=shots to overwrite it).
// BASE_URL=http://localhost:3001 node docs/ui-audit/audit.cjs   to target another port.
const path = require("path");
const fs = require("fs");
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, process.env.AUDIT_OUT || "after");
fs.mkdirSync(OUT, { recursive: true });
const report = {};

async function metrics(page, label) {
  const m = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
    const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="slider"], [role="combobox"], [role="radio"]')].filter(visible);
    const aboveFold = interactive.filter(inView);
    const small = interactive.filter(inView).filter((el) => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
    const tinier = interactive.filter(inView).filter((el) => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
    const texts = [...document.querySelectorAll("body *")].filter((el) => visible(el) && inView(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const sizes = {};
    let tiny = 0; const tinySamples = [];
    for (const el of texts) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      sizes[fs] = (sizes[fs] || 0) + 1;
      if (fs < 12) { tiny++; if (tinySamples.length < 8) tinySamples.push(`${fs}px: ${el.textContent.trim().slice(0, 40)}`); }
    }
    const weights = new Set(texts.map((el) => getComputedStyle(el).fontWeight));
    const colors = new Set(texts.map((el) => getComputedStyle(el).color));
    const words = texts.reduce((n, el) => n + [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim().split(/\s+/).filter(Boolean).length).reduce((a, b) => a + b, 0), 0);
    const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 40)}`);
    return {
      viewport: `${vw}x${vh}`,
      docHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > vw ? document.documentElement.scrollWidth - vw : 0,
      interactiveTotal: interactive.length,
      interactiveAboveFold: aboveFold.length,
      targetsUnder44AboveFold: small.length,
      targetsUnder24AboveFold: tinier.length,
      wordsAboveFold: words,
      distinctFontSizesAboveFold: Object.keys(sizes).map(Number).sort((a, b) => a - b),
      textNodesUnder12px: tiny,
      tinySamples,
      fontWeights: [...weights].sort(),
      distinctTextColors: colors.size,
      headings: headings.slice(0, 25),
    };
  });
  report[label] = m;
  return m;
}

async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

async function signIn(page, next = "/dashboard") {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: /try the demo account/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60000 });
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
}

/** Visit a signed-in route, then screenshot the first screen and record its metrics. */
async function visit(page, prefix, name, route, label) {
  await page.goto(BASE + route);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60000 });
  await settle(page);
  await shot(page, `${prefix}-${name}`);
  await metrics(page, `${label} ${route}`);
}

const FARM = "/dashboard/farm/khor-north";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  };

  // ---------- Desktop 1440x900 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE); await settle(page);
  await shot(page, "d-landing"); await metrics(page, "desktop /");
  await page.goto(`${BASE}/login`); await settle(page);
  await shot(page, "d-login"); await metrics(page, "desktop /login");

  await signIn(page); await settle(page);
  await shot(page, "d-dashboard"); await metrics(page, "desktop /dashboard");
  // History with compare: two maps, Then and Now.
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("region", { name: "History" }).getByRole("switch", { name: "Compare" }).click();
  await page.waitForTimeout(2500);
  await shot(page, "d-dashboard-compare"); await metrics(page, "desktop /dashboard compare");
  await page.getByRole("button", { name: "Close history" }).click();

  await visit(page, "d", "insights", "/dashboard/insights", "desktop");
  await visit(page, "d", "insights-farm", "/dashboard/insights?farm=khor-north", "desktop");
  await visit(page, "d", "farm", FARM, "desktop");
  for (const tab of ["trends", "probes", "method"]) await visit(page, "d", `farm-${tab}`, `${FARM}?tab=${tab}`, "desktop");

  await visit(page, "d", "assistant", "/dashboard/assistant?farm=khor-north", "desktop");
  await page.getByRole("list", { name: "Suggested questions" }).getByRole("button").first().click();
  await page.getByText(/Yield AI model|Claude · LLM fallback|Built-in agronomy engine/).waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "d-assistant-answer"); await metrics(page, "desktop assistant answer");
  await ctx.close();

  // ---------- Laptop 1280x720 and tablet 1024x768 ----------
  for (const [prefix, viewport] of [["l", { width: 1280, height: 720 }], ["t", { width: 1024, height: 768 }]]) {
    const c = await browser.newContext({ viewport });
    const p = await c.newPage();
    watch(p);
    await signIn(p); await settle(p);
    await shot(p, `${prefix}-dashboard`); await metrics(p, `${prefix === "l" ? "laptop" : "tablet"} /dashboard`);
    await visit(p, prefix, "insights", "/dashboard/insights", prefix === "l" ? "laptop" : "tablet");
    await visit(p, prefix, "farm", FARM, prefix === "l" ? "laptop" : "tablet");
    await c.close();
  }

  // ---------- Mobile iPhone 13 ----------
  const mctx = await browser.newContext({ ...devices["iPhone 13"] });
  const mp = await mctx.newPage();
  watch(mp);
  await mp.goto(BASE); await settle(mp);
  await shot(mp, "m-landing"); await metrics(mp, "mobile /");
  await signIn(mp); await settle(mp);
  await shot(mp, "m-dashboard"); await metrics(mp, "mobile /dashboard");
  await mp.getByRole("button", { name: /^Farms/ }).click(); await mp.waitForTimeout(800);
  await shot(mp, "m-farms-sheet");
  await mp.keyboard.press("Escape");
  await visit(mp, "m", "insights", "/dashboard/insights", "mobile");
  await visit(mp, "m", "farm", FARM, "mobile");
  await visit(mp, "m", "farm-probes", `${FARM}?tab=probes`, "mobile");
  await visit(mp, "m", "assistant", "/dashboard/assistant?farm=khor-north", "mobile");
  await mctx.close();

  await browser.close();
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
