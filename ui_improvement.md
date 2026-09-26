# Harvestar AI — UI/UX improvement brainstorm

> Status: proposal / brainstorm. No app code has changed. File references are `path:line` against the
> current `main` (commit `b45e20d`).
>
> **Revision 2 (24 Sep 2026):** added a Playwright audit with measurements (§2.4), page-by-page bad-design
> callouts with screenshots (§2.5), and tabbed charts for Salinity, Moisture, NPK, Temperature and
> Precipitation, including the weather data changes they need (§7.3–7.4). Screenshots and the
> re-runnable audit script are in [`docs/ui-audit/`](docs/ui-audit/).

## 1. Summary

The app's substance is good. The problem is that almost all of it shows at once. The dashboard
currently puts **four columns** side by side (farm list, map + KPIs + chart, AI insight panel, chat).
Every one of them has its own controls, and none of them is clearly "the one thing to look at".

Direction:

1. **The AI leaves the side of the screen.** A single launcher button (bottom-right, plus `⌘/Ctrl K`)
   opens a **full-screen, ChatGPT-style assistant** at `/dashboard/assistant`. It has a history
   sidebar, conversations that persist, and a per-farm context chip.
2. **The AI's written output gets its own home.** A new **Insights & Advice** section at
   `/dashboard/insights` holds risk, summary, prioritised actions and the crop suggestion, grouped by
   what to do this week across all farms.
3. **The dashboard becomes calm by default.** It shows one farm, one map layer (salinity), one chart,
   four KPIs and a short "what to do" card. The time slider, Then-vs-Now, overlays, derived layers,
   probe tables and coefficients all still exist, one click away behind progressive disclosure.

4. **Charts become one tabbed card: Salinity · Moisture · NPK · Temperature · Rain.** One chart at
   a time, in plain words first. Temperature and Rain come from Open-Meteo, and Rain is a new
   data fetch (§7.3).

Nothing powerful is deleted. It is re-layered.

The Playwright audit (§2.4–2.5) backs this up with numbers. The desktop dashboard shows **46 controls,
~480 words and 16 font sizes before the first scroll**, and the phone farm page is **10 screens long**.
It also lists **39 specific bad-design callouts**, each with a screenshot and a fix.

---

## 2. What's cluttered today (audit)

### 2.1 Dashboard `/dashboard` (`components/dashboard/dashboard-shell.tsx`)

At ≥1280 px a user sees all of this at once:

| Region | What's in it | Source |
|---|---|---|
| Header | Menu button, logo, "Farm dashboard", **data-source badge**, optional **weather-offline badge**, **Live switch** with status dot + last-event text, avatar | `dashboard-header.tsx:188-221` |
| Left rail (264–308 px) | 8 farm cards, each with rank, name, crop·ha·region, colour dot, metric value, optional delta chip, **risk badge**, left risk bar | `dashboard-shell.tsx:309-311`, `farm-list.tsx:52-114` |
| Farm heading | Name, risk badge, **Details** button, **Farms** button (<xl), a long facts line (crop · ha · region · owner · soil · probes · stage, day) | `dashboard-shell.tsx:316-330`, `lib/dashboard.ts:159` |
| Map toolbar | **5 probe layers + N/P/K sub-toggle + 4 derived layers** as two segmented controls, plus Satellite/Streets | `layer-switcher.tsx:111-133`, `dashboard-shell.tsx:335-358` |
| Map | "All farms / Zoom to farm" button, floating legend, and in compare mode **two synced maps** with Then/Now chips | `dashboard-shell.tsx:360-426` |
| Timeline | Play button, 60-day slider (dual-thumb in compare), date readout, **Compare switch** | `timeline.tsx:74-157` |
| KPI row | **6 tiles**, each with its own info-tip, tone dot, sub-line and delta chip | `kpi-tiles.tsx:119-228` |
| Chart | Title + info-tip, **"Compare with…" select**, **7/30/60 d** segmented control, then the chart with class bands and markers | `dashboard-shell.tsx:444-503` |
| AI aside (360–440 px) | Risk card (score 40 px, meter, summary), **numbered action list**, crop card with market chip, and then the **chat** (header, info-tip, Clear, log, chips, composer) all squeezed into one column | `dashboard-shell.tsx:506-527` |

**Where the clutter comes from:**

- **Four competing focal points.** The risk score (40 px number in the AI aside), the farm name
  (26 px), the map and the 22 px KPI numbers all try to be the headline.
- **Risk is shown 4 times for the same farm**: the farm-list badge, the risk bar on the list card, the
  heading badge (`dashboard-shell.tsx:318`) and the Risk card (`insight-panel.tsx:86-118`).
- **The AI aside is a split-brain panel.** Insights and chat share one column. A `ScrollFade` resizes
  between 62% and 32% depending on whether the chat is active (`dashboard-shell.tsx:510-514`), so the
  actions get squeezed exactly when you start asking about them.
- **Too many controls at once.** Counting interactive controls visible without scrolling:
  roughly 11 layer buttons, 2 basemap buttons, the zoom button, play, the slider, the compare switch,
  the overlay select, 3 range buttons, 6 info-tips on KPIs, 8 farm cards, 3+ action accordions, 3
  chips, the composer, the Live switch and the avatar. That is **40+ targets**, most of them expert
  features.
- **Expert vocabulary on the default surface**: "ECe, est.", "ET₀", "ETc", "Kc", "RAW",
  "Penman–Monteith · Open-Meteo 6.1" (`kpi-tiles.tsx:178`) and "Derived (FAO-56 / FAO-29)". This is
  accurate, but it isn't a calm first read for a farm manager.
- **System status in the header.** "Demo data", "Weather offline" and Live status are useful but
  compete with navigation, and they are tinted with the same green/amber colours as risk.
- **Colour noise.** Risk colours (`--risk-*`) are also used for the data-source badge, the Live pill,
  delta chips, market chips and KPI tone dots. Colour stops meaning "danger".

### 2.2 Farm details `/dashboard/farm/[id]` (`components/dashboard/farm-detail.tsx`)

- The same map + full layer switcher + timeline + 6 KPIs as the dashboard (`farm-detail.tsx:166-229`).
  It feels like a second dashboard, not a "details" page.
- **11 trend charts** in a 2–3 column grid (`farm-detail.tsx:33, 250-262`), each with its own
  info-tip, legend and value. Nothing ranks them, so the reader has to find the one that matters.
- **Per-probe table**: 9 numeric columns (`probe-table.tsx:7-17`) with class colours in every cell.
- **Agronomy inputs table** (`farm-profile.tsx`) is always expanded.
- **The same AI aside again**, sticky on the right (`farm-detail.tsx:290-309`).
- **Chat history is split between pages.** The dashboard uses key `farm.id` and details uses
  `detail-${farm.id}` (`dashboard-shell.tsx:520` vs `farm-detail.tsx:302`), so a question asked on one
  page is invisible on the other.

### 2.3 AI plumbing: what exists today

- **Chat history is not persisted anywhere.** `ChatPanel` keeps
  `useState<Record<string, Message[]>>` (`chat-panel.tsx:128`). Reloading, navigating to details or
  signing out loses everything. There is no conversations table in
  `supabase/migrations/0001_init.sql` and no `.data/` store for chats.
- The request carries the last **8** turns (`chat-panel.tsx:168-171`). The schema allows 12
  (`lib/ai/contract.ts:88`). The server is stateless: it builds a `ChatContext` per call
  (`app/api/chat/route.ts:33-34`) with the answer chain AI service → Claude → offline engine.
- Answers are not streamed. The "typing" effect is a client typewriter (`hooks/use-typewriter.ts`).
- **Insights are latest-only per farm.** `bundle.insight` holds one row (`lib/types.ts:177`), even
  though Supabase fetches up to 500 rows (`lib/data/supabase-source.ts:140`) and `latestInsightByFarm` (`lib/data/derive.ts:73`) keeps one. There is no insight
  history or risk trend in the UI yet. In mock mode insights are generated on request
  (`lib/data/repository.ts:74`).
- RLS lets every signed-in user read every farm (`0001_init.sql:114-124`). There is no per-user
  ownership. This matters for chat privacy (see §5.4).
- There is **no dark mode**. The theme is "single light theme, tuned for projectors"
  (`app/globals.css`, `:root` block), though a `dark` custom variant is declared (`globals.css:5`).

### 2.4 Measured with Playwright

Method: [`docs/ui-audit/audit.cjs`](docs/ui-audit/audit.cjs) signs in with the demo account and loads every
page at 1440×900 (desktop), 1280×720 (laptop), 1024×768 (tablet) and iPhone 13 (390×664). It
screenshots each page and counts what is actually visible in the first screen ("above the fold").
Raw numbers are in [`docs/ui-audit/shots/metrics.json`](docs/ui-audit/shots/metrics.json).

| Page · viewport | Controls in first screen | Words in first screen | Distinct font sizes | Text runs < 12 px | Length |
|---|---|---|---|---|---|
| Login · desktop (**the calm benchmark**) | 6 | 88 | 7 | 0 | 1 screen |
| Landing · desktop | 20 | 236 | 15 | 17 | 2 screens |
| **Dashboard · desktop** | **46** | **481** | **16** | **54** | 3 inner scroll areas |
| Dashboard + Compare · desktop | 46 | **622** | 16 | **69** | — |
| Dashboard · laptop 1280×720 | 45 | 405 | 14 | 40 | — |
| Farm details · desktop | 35 | 311 | 16 | 38 | 3,751 px ≈ 4 screens |
| Dashboard · phone | 14 (**all 14 under 44×44 px**) | 75 | 10 | 10 | inner scroll 2,740 px ≈ 4.5 screens |
| Farm details · phone | 11 (**all 11 under 44×44 px**) | 67 | 10 | 10 | 6,868 px ≈ **10 screens** |

What the numbers say:

- The dashboard asks the eye to parse **~480 words and 46 controls before the first scroll**. The login
  page, which already feels calm, has 88 words and 6 controls.
- **16 font sizes** on one screen: 10, 10.5, 11, 11.5, 12, 12.5, 12.8, 13, 13.5, 14, 16, 16.8, 18, 22, 26
  and 40 px. Nine of them sit between 10 and 13.5 px, which is too close together to read as
  hierarchy. It reads as noise.
- **54 text runs below 12 px** on the desktop dashboard: map pin values, legend ticks, the "PROBE /
  DERIVED / MAP" captions, the "Demo data" badge and the "High risk, score" badges.
- On a phone, **not one control in the first screen meets the 44×44 px touch-target guideline**.

**Proposed "clutter budget"** for every redesigned page, to be checked by an e2e test (§9, item 20):

| Budget | Target |
|---|---|
| Controls in first screen (desktop) | ≤ 15 |
| Words in first screen | ≤ 150 |
| Distinct font sizes | ≤ 6 (12 / 14 / 16 / 20 / 28 / 36) |
| Text under 12 px | 0, except map attribution |
| Phone touch targets | ≥ 44×44 px, or ≥ 24 px with enough spacing (WCAG 2.2 AA) |
| Scroll containers per page | 1 (the page itself) |

### 2.5 Bad designs, page by page

Each callout names **what's wrong → evidence → fix**. Severity: 🔴 hurts a core task · 🟠 confusing or
noisy · 🟡 polish.

#### Dashboard, desktop ([screenshot](docs/ui-audit/shots/d-dashboard.png))

| # | Sev | What's wrong | Evidence | Fix |
|---|---|---|---|---|
| D1 | 🔴 | **The numbers are below the fold.** At 1440×900 you see a satellite photo and the risk card, but no KPI or chart. | First KPI tile at y = 885 px, chart heading at y = 1,094 px, inside the centre pane ([scrolled](docs/ui-audit/shots/d-dashboard-centre-bottom.png)) | Cap the map at ~45 vh, and put the 4 KPIs directly under the farm title, above the map |
| D2 | 🔴 | **Three independent scroll areas** (farm list, centre `<main>`, AI aside). The page itself never scrolls, and what the mouse wheel moves depends on where the pointer is. | `main.lg:overflow-y-auto` (1,396 px of content in an 844 px pane) and the aside's `ScrollFade` (908 px in 503 px) | One document scroll. Only the header (and optionally the farm heading) stays sticky |
| D3 | 🟠 | **The same risk shown five times** on one screen: list badge "98", red list bar, heading "High risk · 98", 40 px "98 / 100", plus a second "High risk" pill with a red meter. | d-dashboard.png | One risk badge in the heading, and a dot in the list |
| D4 | 🔴 | **Two colour codes on the same farm card contradict each other.** The dot is the *selected layer's* class, while the bar and badge are *risk*. Al Sheehaniya West shows a pale-yellow "1.5 dS/m, non-saline" dot next to a red "88". It is high-risk because it's drying out, but the card only talks about salt. | Farm #2 in d-dashboard.png. The info-tip explaining this is at `farm-list.tsx:42` | Replace the layer value with the **reason** in words: "Drying out", "Salt rising", "Healthy". Show layer values only when the user picks a layer |
| D5 | 🟠 | **The layer switcher is a 2-row, 11-button control** with 11 px uppercase "PROBE / DERIVED / MAP" captions and jargon labels ("ET₀", "ETc"). It pushes the map down ~90 px. | `layer-switcher.tsx:111-133` | A single "Salinity ▾" dropdown (the phone already has one, `layer-switcher.tsx:91-109`). The tabbed charts (§7.3) replace most of the reasons to switch |
| D6 | 🟠 | **One label, two meanings, and three names for one action.** On the dashboard "All farms" *zooms the map out*, while on farm details "All farms" *navigates back*. Zooming to the field is called "Zoom to farm" on one page and "Re-centre" on the other. | `dashboard-shell.tsx:409`, `farm-detail.tsx:155`, `farm-detail.tsx:210` | "← Farms" is only ever navigation. Map-extent buttons are icon-only with tooltips: ⤢ "Show all farms", ⌖ "Fit field" |
| D7 | 🟠 | **The map legend covers the field.** The 255×90 px legend card sits over the bottom-left of the map. At 1280 px it overlaps the polygon itself. | l-dashboard.png | Show a collapsed legend chip ("Salinity · 6.7 dS/m ▸") that expands on click, or put the legend under the map |
| D8 | 🟡 | **The timeline repeats itself.** "Today" is the slider's end label, the date readout says "Thu 24 Sep" and then "Today" again below it, and the Play button has no speed or stop cue. It is always visible, even though almost every visit is about today. | Timeline strip in d-dashboard.png | Put it behind "⟲ History" (§7.1.3). Show the date once |
| D9 | 🟠 | **The first action opens as a 5-line paragraph full of formula references** ("ECw 3.4 dS/m … FAO-29 Eq. 7, 90% yield target"). Action #2 is faded out mid-card by the scroll fade. | d-dashboard.png, right column | Collapse all actions by default. Title plus one plain line; the formula goes in "▸ Why" |
| D10 | 🟠 | **KPI tiles show two ET₀ numbers with no explanation** ("6.5 mm/day … Open-Meteo 6.1"). "Next irrigation **2.2 days**" is a fractional day. | [d-dashboard-centre-bottom.png](docs/ui-audit/shots/d-dashboard-centre-bottom.png), `kpi-tiles.tsx:178` | "Next irrigation: **Sat** (in ~2 days) · 15 mm". Move ET₀ to Method |
| D11 | 🟠 | **In Compare mode, changes are coloured red even when harmless.** A +4 % salinity change on a healthy farm gets the same pink chip as +48 % on the worst farm. Words in the first screen jump from 481 to 622, and each map repeats its own two-line attribution. | [d-dashboard-compare.png](docs/ui-audit/shots/d-dashboard-compare.png) | Neutral delta chips with ↑/↓, turning red only past a threshold (e.g. ECe +20 % or crossing a class). One shared attribution line |
| D12 | 🟡 | **The header leads with system state.** A "Demo data" pill sits right after the page title like a tag, and the Live toggle is the most prominent control in the header. | Header, d-dashboard.png | Replace both with a neutral status dot and popover (§7.1.8) |

#### Dashboard at laptop and tablet sizes ([1280](docs/ui-audit/shots/l-dashboard.png) · [1024](docs/ui-audit/shots/t-dashboard.png))

| # | Sev | What's wrong | Fix |
|---|---|---|---|
| D13 | 🔴 | At 1280×720 the map shrinks to ~380 px, **the probe value labels on the pins disappear** (the pins go blank), the first action fades out after one line, and the KPIs and chart are completely off-screen. | The layout needs a layout budget. Below 1440 px the AI aside is the first thing to go, not the map (which the redesign does anyway) |
| D14 | 🟠 | At 1024 px the farm list collapses into a "Farms" button, but **the AI aside keeps ~330 px**. The layout protects the chat over the map and the numbers. | Same as D13 |

#### AI chat inside the aside ([screenshot](docs/ui-audit/shots/d-dashboard-chat.png))

| # | Sev | What's wrong | Fix |
|---|---|---|---|
| C1 | 🔴 | **Asking a question hides the advice you're asking about.** After one question, *Recommended actions* scrolls out of the aside, because the `ScrollFade` shrinks to 32 % (`dashboard-shell.tsx:510-514`). | The full-screen assistant (§5), with actions on the Insights page (§6) |
| C2 | 🔴 | **The answer is cut off before the advice.** The log is ~370 px tall, and the first answer stops at "What to do:", so the actual recommendation needs a scroll inside a scroll inside an aside. | Full-screen thread, 720 px column |
| C3 | 🟡 | **The suggestion chips don't change after use.** The question you just asked is still offered as a chip. | Hide asked chips and swap in follow-ups ("How much water is that in total?") |
| C4 | 🔴 | **The conversation is lost when you navigate away.** Verified: ask on the dashboard → open farm details → come back, and the thread is gone. | Persistence (§5.4) |
| C5 | 🟡 | **Three nested borders**: the answer card sits inside the log card, which sits inside the aside card. | Flat thread, with no bubble border for AI answers |

#### Farm details, desktop ([top](docs/ui-audit/shots/d-farm.png) · [charts](docs/ui-audit/shots/d-farm-scroll1.png) · [tables](docs/ui-audit/shots/d-farm-scroll3.png))

| # | Sev | What's wrong | Evidence | Fix |
|---|---|---|---|---|
| F1 | 🔴 | **A second dashboard, not a details page.** The whole first screen is the same map, layer switcher and timeline. Nothing detail-specific is above the fold. | d-farm.png | Tabs (§7.2) |
| F2 | 🟡 | **The layer switcher wraps to three rows** here: "MAP · Satellite · Streets" sits alone on row 3. | d-farm.png | Single dropdown (D5) |
| F3 | 🟠 | **11 charts, one shared legend.** "Farm mean · Probe min–max · Shaded bands" appears once at the top, far from 10 of the 11 charts. | d-farm-scroll1.png | Tabbed charts with a legend per chart (§7.3) |
| F4 | 🔴 | **Y-axes exaggerate noise.** pH runs from 8.0 to 8.3, so a 0.1-unit wobble fills the chart and looks alarming. Moisture runs from 10 to 15 %. Salinity starts at 0 but pH doesn't, so the charts aren't comparable. | `niceScale` pads the data's min–max by only 12 % (`metric-chart.tsx:60-84`) | Minimum span per metric (§7.4, rule 1) |
| F5 | 🟠 | **Class-band labels are drawn inside the plot** ("Moderately saline", "14–18 %", "Moderately alkaline") and collide with the data line and range band. | d-farm-scroll1.png | Labels go in the right-hand margin, outside the plot |
| F6 | 🟠 | **N, P and K are three separate charts** with unrelated scales, while the map treats them as one "NPK" layer with a sub-toggle. Neither says whether 47 mg/kg N is enough for a cucumber. | `farm-detail.tsx:33`, `lib/metrics.ts:323` | One NPK tab with 3 aligned strips and crop sufficiency bands (§7.3) |
| F7 | 🔴 | **There is no weather view.** "Soil temperature" is the only temperature. Air temperature *is* fetched from Open-Meteo (`lib/data/weather.ts`, `tmax`/`tmin`) but only used inside ET₀. **Rainfall isn't fetched at all**, and the irrigation countdown assumes no rain (`lib/agronomy.ts:476`). | — | Temperature and Precipitation tabs from Open-Meteo (§7.3) |
| F8 | 🟠 | **Probe table: 9 numeric columns × 6 probes = 54 coloured dots.** Colour stops meaning anything, and the pale-green K dots are nearly invisible on white. | d-farm-scroll3.png | Colour only the cells that break a threshold. The saltiest row is already highlighted, keep that |
| F9 | 🟠 | **~1,000 px of reference material in the main flow.** Agronomy inputs are 11 always-open rows, each with an FAO citation. | d-farm-scroll3.png | "Method" tab, closed by default |
| F10 | 🟡 | **The sticky AI aside is repeated** from the dashboard. It still shows only 3 chips in a box, even on a page with room to spare. | d-farm.png | Launcher (§5.1) |

#### Phone ([dashboard](docs/ui-audit/shots/m-dashboard.png) · [KPIs](docs/ui-audit/shots/m-dashboard-scroll1.png) · [actions](docs/ui-audit/shots/m-dashboard-scroll3.png) · [farms sheet](docs/ui-audit/shots/m-farms-sheet.png))

| # | Sev | What's wrong | Fix |
|---|---|---|---|
| M1 | 🔴 | **The first screen is a header, a title and a map.** The risk explanation and the first action are ~3 screens down, and the chat is 4+ screens down (inner scroll of 2,740 px). | Phone order: title → "What to do" card → KPIs → chart tabs → map. The assistant goes in the bottom tab bar |
| M2 | 🔴 | **All 14 controls in the first screen are under 44×44 px** (zoom buttons, basemap icons, Details/Farms, Live switch). | Raise touch targets to 44 px; `size="lg"` buttons on phones |
| M3 | 🟠 | **The page scrolls inside a `div`, not the document.** That breaks iOS "tap status bar to scroll to top" and address-bar collapse, and makes the page feel "stuck" (a full-page screenshot only captures the first screen). | Document scroll (same fix as D2) |
| M4 | 🟠 | **The Live toggle takes a third of the header** on a 390 px screen. | Move it to the status popover |
| M5 | 🟡 | **KPI sub-lines wrap mid-token**: "Open-/Meteo 6.1", "Cucumber tolerates 2.5 / dS/m". | Shorter sub-lines (D10), 1 column under 400 px |
| M6 | 🟡 | **The Farms sheet has two headers**: "Farms / Ranked by AI risk score." and then "FARMS · 8 / Ranked by risk · Salinity (ECe), today". | Drop the inner list header when it's inside the sheet (`dashboard-shell.tsx:543` vs `farm-list.tsx:47`) |
| M7 | 🟡 | **The map attribution wraps to two lines** of 10 px text over the map. | Leaflet `attributionControl` with a collapsed "ⓘ" on phones |
| M8 | 🔴 | **Farm details is ~10 phone screens** (6,868 px). | Tabs (§7.2) and chart tabs (§7.3) |

#### Content and logic

| # | Sev | What's wrong | Fix |
|---|---|---|---|
| X1 | 🔴 | **The crop suggestion contradicts itself.** The card recommends **Zucchini** on a mint-green "good news" card, next to an amber **"Oversupplied"** chip that says to avoid the glut ([m-dashboard-scroll3.png](docs/ui-audit/shots/m-dashboard-scroll3.png)). The market note comes from `lib/agronomy-tables.ts:109`/`157`, but market status doesn't affect the ranking. | Rank by salt tolerance × market. If the best agronomic pick is oversupplied, say so plainly: "Best for this salt level: Zucchini, but the market is oversupplied in peak season. Alternative: Barley (fodder, undersupplied)." Show 2 options |
| X2 | 🟠 | **The same irrigation fact is written three different ways**: "Next irrigation 2.2 days · 11 mm net · 15 mm with leaching" (KPI), "Irrigate 15 mm instead of 11 mm at the next cycle" (action #1) and "Next irrigation in about 2 days: 15 mm" (action #4, marked LOW while #1 is HIGH). | One sentence, in one place: "Irrigate **15 mm** on **Sat** (includes 26 % extra to wash out salt)" |

#### Landing and login ([landing](docs/ui-audit/shots/d-landing.png) · [login](docs/ui-audit/shots/d-login.png))

These are the **best pages in the app, so use them as the style reference**. Login has one clear
primary action, a calm two-column layout and 7 font sizes. The landing page's farm card (name, one
risk badge, a 3-line summary, "Next step: …") is almost exactly the **"What to do" card** proposed for the
dashboard (§6.2). Reuse it. Minor issues: the landing page also uses 15 font sizes, and its map pins
use 11 px values.

---

## 3. Design principles

1. **One primary question per screen.** The dashboard answers "Which farm needs me, and what's
   happening there?" Insights answers "What should I do this week?" The assistant answers "Help me
   think." Farm details answers "Show me the evidence."
2. **Plain language first, numbers on demand.** Lead with "Salinity is rising, and tomato yield is
   down ~12%". Put "ECe 5.8 dS/m, Maas–Hoffman b = 9.9" one tap away (info-tip, expand or details).
3. **Progressive disclosure, never deletion.** Every expert control survives. Default views show a
   curated subset, with an obvious "More" or "Advanced" affordance.
4. **Colour means risk.** Red, amber and green are reserved for risk and health states. System status
   (data source, live, weather) uses neutral grey and icons.
5. **Show each fact once per screen.** One risk indicator per farm per view.
6. **Calm defaults, remembered choices.** Salinity layer, 30 days, no compare. The user's last layer,
   range and panel states are remembered (URL for shareable state, `localStorage` for preferences).
7. **Mobile is a first-class layout, not a squeeze.** Bottom tab bar, full-screen sheets, one column.

---

## 4. New information architecture

### 4.1 Top-level sections

| Section | Route | Purpose |
|---|---|---|
| **Overview** | `/dashboard` | Farms ranked by risk, the map, and the selected farm's snapshot |
| **Insights & Advice** | `/dashboard/insights` (`?farm=` filter) | All AI assessments and actions, and the weekly plan |
| **Farm** | `/dashboard/farm/[id]` | Evidence for one farm, with tabs: Overview · Trends · Probes · Method |
| **Assistant** | `/dashboard/assistant`, `/dashboard/assistant/[conversationId]` | Full-screen chat with history |
| Settings (later) | `/dashboard/settings` | Units, theme, default layer, live mode, data source status |

Keeping every new route under `/dashboard/*` means the existing `proxy.ts` matcher
(`proxy.ts:73`, `"/dashboard/:path*"`) protects them with no change.

### 4.2 Navigation shell

Desktop uses a **slim left icon rail** (56 px, labels on hover or expanded at ≥1536 px). It replaces
the always-open farm list and the header clutter. The farm list moves inside the Overview page as a
collapsible panel.

```
┌──┬──────────────────────────────────────────────────────────────────┐
│YA│  Overview                          [Search farms ⌘K]   ● Demo  (MO)│
│──│──────────────────────────────────────────────────────────────────│
│▣ │                                                                  │
│Ov│                    (page content)                                │
│✦ │                                                                  │
│In│                                                                  │
│◧ │                                                                  │
│Fa│                                                                  │
│  │                                                                  │
│⚙ │                                                       ╭────────╮ │
│  │                                                       │✦ Ask AI│ │
└──┴───────────────────────────────────────────────────────╰────────╯─┘
 rail: Overview · Insights · Farms · (Settings)       floating launcher
```

- **Header** shrinks to: page title, global search/command (`⌘K`), a single neutral **status dot**
  (data source + live + weather merged into one popover), and the avatar.
- **Live mode** moves into that status popover and the Overview map toolbar. It is a demo feature
  and shouldn't sit in global chrome.
- **Mobile**: a bottom tab bar (Overview · Insights · Assistant · Farms). The launcher becomes the
  middle tab.

---

## 5. AI Assistant: full-screen, ChatGPT-style

### 5.1 Entry points

- **Floating launcher**, bottom-right on every `/dashboard/*` page: a pill "✦ Ask AI" (icon-only on
  scroll or mobile). It opens the assistant **pre-scoped to the farm being viewed**.
- **Keyboard**: `⌘/Ctrl + J` opens the assistant. (`⌘K` stays reserved for search.) `Esc` returns to
  where you were.
- **"Ask AI about this"** buttons on insight cards, KPI info-tips and chart headers open a *new*
  conversation seeded with that context (see §6.3).
- The rail's ✦ icon.

**Recommendation:** make it a **real route** (`/dashboard/assistant/[id]`), not a modal. Deep links,
the back button and refresh then all just work, and the chat gets a full viewport. To "return to the
dashboard", the top-left **← Back to {Farm}** uses `router.back()` when there's history and falls
back to `/dashboard?farm=…`. (A Next.js intercepting route could render it as an overlay while
keeping the dashboard mounted behind it. That's a nice-to-have. Read
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/intercepting-routes.md`
and `parallel-routes.md` first, because this Next.js version differs from older ones.)

### 5.2 Layout

```
┌──────────────────────┬──────────────────────────────────────────────────────┐
│ ← Back to Al Khor N. │  Farm: [Al Khor North ▾]   as of [Today ▾]      ⋯    │
│ [+ New chat]         │──────────────────────────────────────────────────────│
│ [Search chats…]      │                                                      │
│                      │        You: How much should I irrigate?              │
│ Pinned               │                                                      │
│  ◆ Leaching plan     │   ✦  Irrigate 18 mm net today (24 mm with a 25%      │
│ Today                │      leaching fraction). Probe P3 in the north-east  │
│  Why is salinity…  ⋯ │      is the saltiest at 6.1 dS/m…                    │
│  Irrigation for Al…  │      ▸ Sources: FAO-56 Eq. 82–87 · FAO-29 Eq. 7–8    │
│ Previous 7 days      │      Built-in agronomy engine · 👍 👎 ⧉ ↻             │
│  What to plant nex…  │                                                      │
│  Umm Salal tomato…   │                                                      │
│                      │   ┌──────────────────────────────────────────────┐   │
│ Filter: [All farms▾] │   │ Ask about Al Khor North…                  ⏎  │   │
│                      │   └──────────────────────────────────────────────┘   │
│ (MO) demo@…          │    Answers use this farm's probe readings. ⓘ         │
└──────────────────────┴──────────────────────────────────────────────────────┘
   260 px, collapsible        thread max-width ~720 px, centred
```

- **History sidebar**: New chat · search · Pinned · date groups (Today / Previous 7 days / Older) ·
  farm filter. Each row has a farm tag (small neutral chip, *not* risk-coloured) and a `⋯` menu with
  Rename, Pin, Change farm and Delete (with an undo toast).
- **Context bar**: a **farm selector** (required, because `ChatRequestSchema.farm_id` is required,
  `contract.ts:81`) plus an optional **"as of" day** (maps to the existing `date` field). An
  "All farms" mode for portfolio questions needs a new server path. Park it as an open question.
- **Thread**: centred column of about 720 px, the same `Markdown` renderer, the answer-source label
  kept but de-emphasised. Add copy, regenerate and feedback. Collapse the "where answers come from"
  text behind one ⓘ in the composer footer (it is now in the chat header, `chat-panel.tsx:211-215`).
- **Empty state**: a greeting ("Ask about **Al Khor North**"), 4 prompt cards built from
  `suggestedQuestions()` (`lib/dashboard.ts:148`) plus one insight-driven prompt (e.g. "Walk me
  through action #1"), and a line showing the farm's current risk in words.
- **Composer**: auto-growing textarea (keep the current Enter/Shift+Enter handling,
  `chat-panel.tsx:323-328`), and a stop button while pending. Later, streaming.
- **Mobile**: the history is a left sheet opened from a ☰ in the top bar. The thread is full-screen,
  and the composer is pinned above the keyboard (`100dvh`, safe-area padding).

### 5.3 Titles, search, retention

- **Auto-title**: at first, the first question truncated to about 48 characters (instant and free).
  After the first answer, optionally ask the LLM for a 3–6 word title when `ANTHROPIC_API_KEY` is
  set. Titles are always renamable.
- **Search**: `ilike` on title and message content (Supabase), or a simple in-memory filter
  (local store). Full-text search can wait.
- **History sent to the model**: keep sending the last N turns from the stored conversation. The
  server should load them from storage by `conversation_id` instead of trusting the client, which also
  fixes the 8-vs-12 mismatch.

### 5.4 Persistence: data model

**Supabase** (new migration `0002_conversations.sql`):

```sql
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  farm_id text references public.farms (id) on delete set null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.conversations (user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  source text check (source in ('ai-service', 'llm', 'offline')),  -- ChatAnswerSource
  model text,
  as_of date,                -- the day the answer was grounded on
  insight_id uuid references public.ai_insights (id) on delete set null, -- "Ask AI about this"
  created_at timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
create policy "own conversations" on public.conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own messages" on public.messages
  for all to authenticated using (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
```

Unlike the farm tables (readable by all), chats are **private per user**.

**Local fallback** (no Supabase, same pattern as `lib/auth/local-users.ts`): store
`.data/conversations/<userId>.json`, one file per user, holding
`{ conversations: Conversation[], messages: Record<id, Message[]> }`. Write atomically, and fall back
to memory on read-only file systems as `local-users.ts` does. The local demo user id is
`local-demo` (`local-users.ts`, `getDemoUser`). Consider resetting the demo user's chats daily so
public demos stay clean.

**API** (route handlers under `app/api/conversations/…`, or Server Actions):
`GET /api/conversations?farm=`, `POST /api/conversations`, `PATCH /:id` (title, pinned, farm),
`DELETE /:id`, `GET /:id/messages`. `POST /api/chat` gains an optional `conversation_id`. It appends
the user message and the answer server-side, and returns `conversation_id` so the first message
creates the conversation. Add these shapes to `lib/ai/contract.ts`, which is where the README says
all AI formats live.

**Component reuse**: split `ChatPanel` into a `ChatThread` (messages + composer, which the landing
page's `components/landing/demo-chat.tsx` keeps using with `composer={false}`) and a new
`AssistantPage` with the sidebar and data loading.

---

## 6. Insights & Advice section

### 6.1 Purpose and layout

This page answers "What should I do this week, across my farms?" It is built from the same
`ai_insights` rows (`contract.ts:51-60`). The risk, summary and recommendations move here from the
side panel.

```
┌─ Insights & Advice ──────────────────────────────── [All farms ▾] [This week ▾]┐
│                                                                                │
│  This week · 5 actions across 3 farms            Updated 2 h ago · How it works│
│                                                                                │
│  ┌─ HIGH ───────────────────────────────────────────────────────────────────┐  │
│  │ ● Al Khor North · Tomato                                          72 /100│  │
│  │   Leach salts: apply 24 mm with a 25% leaching fraction                  │  │
│  │   ECe rose 18% in 30 days; P3 (north-east) is the hotspot.   [▸ Why]     │  │
│  │   [Mark done]  [Ask AI about this]  [View on map]                        │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ HIGH ───────────────────────────────────────────────────────────────────┐  │
│  │ ● Umm Salal East · Cucumber   Irrigate today: 18 mm net           65 /100│  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ MEDIUM ── … ────────────────────────────────────────────────────────────┐  │
│                                                                                │
│  ── Farm assessments ─────────────────────────────────────────────────────     │
│  ┌ Al Khor North ● High ┐ ┌ Umm Salal East ● High ┐ ┌ Al Shamal ● Low ┐        │
│  │ Summary (2 lines)…   │ │ Summary…               │ │ Summary…        │        │
│  │ ▁▂▃▅▆ risk, 30 d     │ │ ▂▂▃▄▅                  │ │ ▃▃▂▂▂           │        │
│  └──────────────────────┘ └────────────────────────┘ └─────────────────┘        │
│                                                                                │
│  ── Next season: crop suggestions ──────────────────────────────────────────   │
│  ┌ Al Khor North → Barley  ↑ In demand ┐  "Tolerates 8 dS/m; local market       │
│  │ Why: salt-tolerant…   ▸ Market note  │   short of fodder…"                   │
│  └──────────────────────────────────────┘                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **"This week" action list**: flatten `recommendations` from every farm's latest insight, sort by
  priority and then farm risk score, and show the top 5–7 with "Show all". Each card has a
  one-line title, a one-line reason, and **▸ Why** to expand `detail` plus the method line.
- **Farm assessments**: one card per farm with a risk level word, score, 2-line summary and a
  sparkline of `risk_score` over time. That last part needs insight history, which is **a data change**:
  keep more than the latest row per farm (Supabase already fetches the rows, but
  `latestInsightByFarm` in `lib/data/derive.ts:73` keeps only the latest). In mock mode, generate a weekly
  series from the 60-day window.
- **Crop suggestions**: grouped separately, because it's a seasonal decision and not a weekly one.
  Keep `marketSignal()` (`insight-panel.tsx:18-22`) but make the chip neutral with an arrow icon, not
  green or amber.
- **Sources and method on demand**: a "How it works" drawer explaining the risk score (the current
  info-tip text at `insight-panel.tsx:92-93`, plus the note in `lib/data/insights.ts:6-7` that it's a
  product heuristic).
- **Per-farm view**: `/dashboard/insights?farm=al-khor-north` shows that farm's full assessment:
  summary, all actions and crop suggestion. Later, a timeline of past insights ("what changed since
  last week").
- **"Mark done"** (optional, phase 3): needs an `action_status` table per user. Without it, omit the
  button rather than fake it.

### 6.2 On the Overview page

Replace the full AI aside with a compact **"What to do" card**: risk in words, the #1 action, and
links to "All advice for this farm →" and "✦ Ask AI". That's one card instead of three sections plus
a chat.

### 6.3 "Ask AI about this" handoff

A click creates a conversation with `farm_id`, `insight_id` and a seeded first user message such as
*"Explain this recommendation and how to do it: Leach salts — apply 24 mm…"*, then routes to
`/dashboard/assistant/[id]`. The server already includes `latest_insight` in `ChatContext`
(`contract.ts:207`), so the answer stays grounded.

---

## 7. Decluttering Overview and Farm details

### 7.1 Overview (`/dashboard`)

```
┌──┬─────────────────────────────────────────────────────────────────────────┐
│  │ Al Khor North  ● High risk                       [Farms ▾ 8] [Details →]│
│  │ Tomato · 4.2 ha · mid-season                                            │
│  │ ┌───────────────────────────────────────────────┐ ┌───────────────────┐ │
│  │ │ [Salinity ▾]                      [⧉ Layers]  │ │ What to do        │ │
│  │ │                                               │ │ Salinity is rising│ │
│  │ │              MAP (all farms)                  │ │ ▸ Leach 24 mm     │ │
│  │ │                                               │ │ All advice →      │ │
│  │ │ legend                              ⟲ History │ │ ✦ Ask AI          │ │
│  │ └───────────────────────────────────────────────┘ └───────────────────┘ │
│  │ ┌ Salinity 5.8 ┐ ┌ Yield loss 12% ┐ ┌ Moisture 18% ┐ ┌ Irrigate: Now ┐   │
│  │ ┌ Salinity · last 30 days ───────────────────────── [30 d ▾] [⋯] ┐      │
│  │ │  chart                                                         │      │
│  │ └────────────────────────────────────────────────────────────────┘      │
└──┴─────────────────────────────────────────────────────────────────────────┘
```

Concrete changes:

1. **Farm list → collapsible panel / popover.** The left `<aside>` (`dashboard-shell.tsx:309`)
   becomes a "Farms (8)" button that opens a panel, pinned open by default only at ≥1536 px. Simplify
   each card to name, crop and a risk dot. The metric value and delta only appear when a
   non-default layer is active or History is on.
2. **Layer picker: one dropdown, not 11 buttons.** Replace the two segmented rows
   (`layer-switcher.tsx:111-132`) with a single `Select` (the phone menu at `layer-switcher.tsx:91-109`
   already does this well, so use it everywhere). Group it as **Main** (Salinity, Moisture, Yield
   loss, Water deficit) and **More** (pH, temperature, N/P/K, ET₀, ETc). Satellite/Streets moves into a
   small "⧉ Layers" map-control popover together with Live mode.
3. **History instead of an always-visible timeline.** Hide `Timeline` (`dashboard-shell.tsx:427-437`)
   behind a "⟲ History" map button. Opening it shows the slider as a bottom sheet on the map, with
   **Compare Then vs Now** as a toggle inside. The default is "Today", and a small "Viewing 25 Aug ·
   Back to today" pill appears whenever the date isn't today.
4. **KPIs: 6 → 4.** Keep Salinity, Predicted yield loss, Soil moisture and Next irrigation. Move
   ET₀ and ETc (`kpi-tiles.tsx:167-206`) to Farm details → Method. Sub-lines use plain words ("High
   for tomato"). Formulas stay in the info-tip.
5. **One chart with fewer controls.** Keep the chart for the selected layer. Put the "Compare
   with…" overlay and 7/30/60 behind a `⋯` menu with a single range dropdown (`dashboard-shell.tsx:451-482`).
6. **One risk indicator.** Keep the heading badge. Drop the risk bar and badge duplicates in the
   compact farm list (a dot only) and remove the big Risk card from Overview.
7. **Remove the AI aside** (`dashboard-shell.tsx:506-527`) in favour of the "What to do" card and the
   launcher. This removes the `chatActive` resizing logic entirely.
8. **Header status**: merge `SourceBadge` and "Weather offline" (`dashboard-header.tsx:199-216`) into
   one neutral status dot with a popover. Use amber only when data is degraded.

### 7.2 Farm details (`/dashboard/farm/[id]`)

Turn the long scroll into **tabs** with a stable header:

```
← All farms   Al Khor North  ● High risk                         ✦ Ask AI
[ Overview ]  [ Trends ]  [ Probes ]  [ Method ]
```

- **Overview**: field map (single layer dropdown), 4 KPIs, and this farm's full advice (from
  Insights). This is the only tab with the map.
- **Trends**: the **tabbed "Soil & weather" chart card** (§7.3) at full size, with one chart per tab
  instead of the 11-chart grid. ET₀, ETc, water deficit, yield loss and pH move *into* the tab they
  explain rather than getting charts of their own.
- **Probes**: the per-probe table (`probe-table.tsx`), with column groups. The default columns are ECe,
  Moisture, Deficit and Yield loss, and a "Nutrients & pH" toggle shows the rest. On mobile, use
  probe cards instead of a 9-column table.
- **Method** ("How we calculated this"): `FarmProfile` (agronomy inputs), ET₀/ETc tiles, the
  risk-score explanation and sources, in accordions. Closed by default.
- Remove the sticky AI aside (`farm-detail.tsx:290-309`). The launcher opens the assistant scoped to
  this farm. Keep the tab in the URL (`?tab=trends`) so it can be shared.

### 7.3 Soil & weather charts in tabs

**One chart card, five tabs, one chart visible at a time.** This replaces the 11-chart grid on farm
details (F3, F8) and the single layer-bound chart on the dashboard. The tabs are:

```
[ Salinity ]  [ Moisture ]  [ NPK ]  [ Temperature ]  [ Rain ]
   soil          soil        soil      online · air     online
```

**Tab order**: this follows the risk drivers for northern Qatar (salt, then water, then nutrients,
then weather). **Default tab**: the one behind the farm's top risk, e.g. Moisture for a farm
that is drying out, Salinity for a salty one. Otherwise Salinity. The tab is kept in the URL
(`?chart=rain`) and remembered per user.

A **tab badge** is the *only* colour on a tab. A small red or amber dot appears when that metric is
currently in a risk class, e.g. `Salinity ●`. There's no dot when it's fine. This follows the principle
"colour means risk" (§3).

#### Shared anatomy (every tab looks the same)

```
┌ Soil & weather ─────────────────────────────────────────────────────────────────┐
│ [ Salinity ● ] [ Moisture ] [ NPK ] [ Temperature ] [ Rain ]        [30 days ▾] │
│─────────────────────────────────────────────────────────────────────────────────│
│ 6.7 dS/m  Moderately saline   ↑ 48% in 30 days                                  │ ← headline: value · class in words · change
│ Above cucumber's 2.5 dS/m limit, so about 54 % of the yield is at risk.        │ ← one plain-language line
│                                                                                 │
│  10 ┤                                                        ╭──── Strongly     │
│   8 ┤                                               ___,--'''     Moderately    │ ← band labels in the right margin (F5)
│   6 ┤                         ___,---'''''''''''''                              │
│   4 ┤  ______,---''''''''''''                                     Slightly      │
│ 2.5 ┤- - - - - - - - - - - - - - - - - - - - - - - - - - - - -  Crop limit      │
│   0 ┼──────────┬──────────┬──────────┬──────────┬──────────┤ Today              │
│      25 Aug     1 Sep      8 Sep      15 Sep     22 Sep                         │
│  ── Farm mean   ░ Probe range   - - Crop limit          [ Show each probe ]     │ ← legend attached to this chart
│─────────────────────────────────────────────────────────────────────────────────│
│ Yield loss 54 %  ·  Saltiest probe SG-06 (8.1)      Source: 6 probes · daily   │ ← 1–2 secondary stats + source
│                                                   ✦ Ask AI about this chart →  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Every tab has: a headline value with its class in words and the change over the range, **one
sentence of meaning**, one chart, a legend that belongs to that chart, at most two secondary stats, a
source line and an "Ask AI about this chart" handoff that opens the assistant with the farm, tab and range
pre-filled. The range control (7 / 30 / 60 days) is **shared across tabs**, so switching tabs compares
like with like.

#### What each tab shows

| Tab | Main chart | Reference lines / bands | Secondary stats | Absorbs (today's separate charts) | Data |
|---|---|---|---|---|---|
| **Salinity** | ECe farm-mean line + probe min–max band | Crop threshold (dashed, from FAO-29, already in `FarmDay.eceTarget`); FAO salinity classes as faint bands | Predicted yield loss % · saltiest probe | *Salinity*, *Predicted yield loss* | Probes (existing) |
| **Moisture** | Soil moisture (% VWC) line + probe band | **Irrigation trigger (RAW)** line (already drawn today), and markers on days an irrigation was recommended | "Next irrigation **Sat** · 15 mm", water deficit % of RAW, crop water use ETc | *Soil moisture*, *Water deficit*, *ET₀*, *ETc* | Probes + FAO-56 (existing) |
| **NPK** | **Three aligned strips** (N, P, K), 110 px each, sharing the x-axis, each with its own y-scale | **Crop sufficiency band** per nutrient (green = adequate) | Lowest nutrient vs target ("K 107 mg/kg, adequate"), soil pH (it controls nutrient uptake) | *N*, *P*, *K*, *Soil pH* | Probes (existing). Sufficiency ranges are **new data** (§10 Q10) |
| **Temperature** (online) | **Air temperature from Open-Meteo**: daily min–max band + mean line, with the **7-day forecast** drawn lighter after a "Today" divider | Crop **heat-stress line** (e.g. 35 °C for cucumber/tomato; new per-crop data) | Days above the heat line in range · today's high/low · optional **"Soil (probes)" overlay** toggle, labelled as a different source | *Soil temperature* (as an overlay) | Open-Meteo `temperature_2m_max/min/mean` (max/min already fetched) |
| **Rain** (online) | **Daily rainfall bars** (mm), past and forecast, with forecast bars hatched and labelled with probability | Optional **cumulative line: rain vs crop water use (ETc)**, which shows the gap irrigation must fill | Total in range · "Last rain: 14 Mar" · next 7 days' chance of rain | — (new) | Open-Meteo `precipitation_sum`, `precipitation_probability_max` (**not fetched today**) |

#### Rain needs a proper empty state

Northern Qatar gets roughly 70–80 mm of rain a year, and almost none from May to October. A 60-day bar
chart will usually be **all zeros**, which looks broken. Rules:

- If the total rain in the range is 0 mm, **don't draw empty axes**. Show a one-line state instead:
  *"No rain in the last 60 days. Irrigation is this farm's only water source."* Below it, the
  **cumulative ETc line** ("the crop used 312 mm this period") keeps the tab useful, plus a small 7-day
  forecast strip.
- If there is rain, show the bars. Mark days with more than 5 mm on the Moisture tab too (a small ☂ tick on
  the x-axis), because rain explains moisture jumps.

```
┌ [ Salinity ] [ Moisture ] [ NPK ] [ Temperature ] [ Rain ] ─────────── [60 days ▾] ┐
│ 0 mm in 60 days   ·   Last rain 14 Mar                                              │
│ No rain in this period. Irrigation is this farm's only water source.                │
│                                                                                     │
│  Crop water use vs rain (cumulative, mm)                                            │
│  400 ┤                                                         ___,--- ETc 312 mm   │
│  200 ┤                         ___,---'''''''''''''                                 │
│    0 ┼━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Rain 0 mm    │
│                                                                                     │
│  Next 7 days  Fri ░ 0%  Sat ░ 0%  Sun ░ 5%  Mon ░ 0%  …        Source: Open-Meteo   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### Where the card appears

- **Farm details → Trends tab**: full width, 7 / 30 / 60 days. It replaces the grid of 11 charts.
- **Dashboard (Overview)**: the same card, compact (220 px chart, 30 days), under the KPIs. The **tab
  and the map layer stay in sync** for the soil tabs (Salinity ↔ ECe layer, Moisture ↔ moisture layer,
  NPK ↔ N/P/K layer). Temperature and Rain are farm-level weather, so they leave the map alone. A
  small note reads "Weather is the same across the field."
- **Insights (§6)**: each action card's "▸ Why" can deep-link to the relevant tab
  (`/dashboard/farm/[id]?tab=trends&chart=moisture`).
- **Phone**: the tabs become a horizontally scrollable row of 44 px pills that sticks under the
  farm title. Don't use swipe gestures to change tabs, because they fight with scrubbing the chart.
  The chart is 200 px tall, and the tooltip becomes a tap-to-pin readout above the chart.
- **Accessibility**: a real `role="tablist"` with arrow-key navigation (add shadcn `Tabs` to
  `components/ui/`, since there's none yet). Each chart gets a text summary for screen readers,
  built from the headline and meaning lines.

#### Data changes the weather tabs need

1. **Fetch more from Open-Meteo** (`lib/data/weather.ts:13-21`). Add `temperature_2m_mean`,
   `precipitation_sum` and `precipitation_probability_max` to `DAILY_VARS`. Change `forecast_days`
   from `"1"` to `"7"` (`weather.ts:75`) for the forecast strip. ET₀ and the water balance must keep using past days and
   today only, so filter forecast days out wherever `byFarm[farm][date]` feeds `deriveFarmDay`.
2. **Types** (`lib/types.ts:91`). Extend `WeatherDay` with `tmean`, `precip` and `precipProb`. Expose
   the online series *separately* from `FarmDay.airTmax/airTmin`: today those are filled from the probe's air
   sensor **or** Open-Meteo depending on `airSource`, so they can't be labelled "from online". A
   `weatherDays: WeatherDay[]` field on `FarmBundle`, covering past and forecast days and aligned by date, keeps the
   source unambiguous.
3. **History length**: `past_days` is capped at 92 (`weather.ts:74`), which is enough for 7 / 30 / 60
   days. A "season" or "year" range later would need Open-Meteo's archive API (about a 5-day lag), so
   keep 60 days as the maximum for now.
4. **Water balance (follow-up)**: the irrigation countdown assumes no rain (`lib/agronomy.ts:476`,
   FAO-56 Eq. 85 with P = 0). With `precipitation_sum`, effective rain can be subtracted from depletion.
   In Qatar this rarely changes the number, but when it does rain the countdown should move, and the
   Rain tab shouldn't disagree with "Next irrigation".
5. **Offline and demo mode**: when `OPEN_METEO_DISABLED=true` or the API is unreachable
   (`weather.source === "unavailable"`), the two weather tabs show an honest state, not synthetic
   data: *"Weather unavailable. Retry"*, with the last cached date if there is one. The soil tabs are
   unaffected.
6. **AI context**: add a rain and heat summary to `ChatContext` (`lib/ai/contract.ts:137`) so "Ask AI about
   this chart" on the Temperature and Rain tabs gets grounded answers.

### 7.4 Chart design rules (all tabs, all pages)

1. **A minimum y-span per metric, so noise isn't exaggerated (fixes F4).** Today `niceScale`
   (`metric-chart.tsx:60-84`) fits the data plus 12 %. Add a floor on the span:

   | Metric | Baseline | Minimum span |
   |---|---|---|
   | Salinity (ECe) | 0 | 0 – max(data, crop limit × 1.5) |
   | Soil moisture | 0 | 20 %-points |
   | N / P / K | 0 | top of the crop sufficiency band |
   | Soil pH | — | 1.0 pH unit, centred on the data |
   | Temperature (air/soil) | — | 15 °C |
   | Rain | 0 | 10 mm (bars) |

2. **Band labels go outside the plot**, in a right margin, never over the data (F5).
3. **Each chart has its own legend**, listing only the series actually drawn (F3).
4. **Colour**: the farm line is always the brand forest green, and the probe band is neutral grey-green.
   Class bands are at most 12 % opacity. Red appears only on risk thresholds (the crop limit, the heat
   line), never as decoration.
5. **Today is always marked** with a vertical rule labelled "Today". Forecast data after it is drawn
   lighter and hatched, and never mixed into averages.
6. **Tooltip**: date · value with its unit · class in words · change since the start of the range. On a phone
   it's tap-to-pin.
7. **Annotations over legends**: mark the few events that explain the line (rain > 5 mm, the day an
   insight flagged the farm, irrigation recommended) with small x-axis ticks, not extra series.
8. **One x-axis format** everywhere ("1 Sep"), with at most 5 ticks. The same range applies across tabs.

---

## 8. Visual design

- **Spacing**: an 8-pt grid. Cards get 20–24 px padding on desktop (now 12–16 px, e.g.
  `p-3 sm:p-4`), and there are 24 px gaps between sections. Whitespace is the main way to reduce
  clutter.
- **Type scale** (Geist for UI, Fraunces for display, both already loaded): 12 / 14 / 16 / 20 / 28 /
  36. Retire the in-between sizes (`text-[11.5px]`, `[12.5px]`, `[13.5px]`, `[10.5px]`), because the
  many near-identical sizes read as noise. Uppercase micro-captions are used for at most one level
  of section labels.
- **Colour**: sand and forest stay as the brand. **Red, amber and green only for risk and health.**
  Data source, live, market and delta chips go neutral, with an icon (↑/↓) carrying the direction.
  Delta chips can keep the colour only when the delta is itself a risk signal.
- **Cards**: one style everywhere (`rounded-2xl`, 1 px border, `shadow-xs`, no nested bordered
  boxes inside cards). Today there are cards inside cards, e.g. action `li` borders inside the aside.
- **Icons**: lucide at 16 px in controls and 20 px in empty states. Use icon + label for primary
  actions and icon-only with a tooltip for map controls.
- **Empty and loading states**: skeletons that match the final layout (there are `loading.tsx`
  files already). The assistant empty state uses prompt cards. The Insights empty state reuses the
  current copy (`insight-panel.tsx:69-79`) in plainer words, and "Ask AI instead" becomes a button.
- **Dark mode**: worth doing *after* the restructure. The `dark` variant exists (`globals.css:5`)
  but no dark tokens do. Map tiles need a dark basemap, and the salinity colour ramps must be
  re-checked for contrast. Meanwhile the chat and insights pages can be designed with tokens only,
  so dark mode stays cheap later.
- **Motion**: 150–200 ms fades and slides for sheets, the launcher → full-screen transition and
  accordions. Keep the live pulse and flash (`yai-flash`) but only on the map and list. Respect
  `prefers-reduced-motion`. Keep the typewriter only until real streaming lands.

---

## 9. Quick wins vs bigger changes

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | Single layer dropdown everywhere (reuse the phone `Select`) | S | High |
| 2 | KPIs 6 → 4, ET₀/ETc moved to details | S | Med |
| 3 | Timeline behind a "History" toggle, default Today | S–M | High |
| 4 | Chart overlay and range behind a `⋯` menu | S | Med |
| 5 | Neutral system-status dot (merge source/weather badges) | S | Med |
| 6 | Remove duplicate risk displays and neutralise non-risk colours | S | Med |
| 7 | **Persist chats in `localStorage` per farm** (a stop-gap before the DB) | S | Med |
| 8 | Remove the AI aside, add the floating launcher, and build `/dashboard/assistant` (no history yet) | M | **High** |
| 9 | Conversations and messages persistence (Supabase + `.data/` fallback), history sidebar | M–L | **High** |
| 10 | `/dashboard/insights` page from existing latest insights | M | **High** |
| 11 | Farm details → tabs (Overview · Trends · Probes · Method) | M | High |
| 12 | Left icon rail and mobile bottom tabs | M | Med |
| 13 | Insight history (risk sparkline, "what changed") | M–L | Med |
| 14 | Streaming answers, LLM-generated titles | M | Med |
| 15 | Dark mode | M–L | Low–Med |
| 16 | "Mark done" for actions, portfolio ("All farms") chat | L | Med |
| 17 | **Bug-level fixes from §2.5**: one scroll container (D2/M3), farm card shows the risk *reason* (D4), one "All farms" meaning (D6), crop suggestion vs market (X1), one irrigation sentence (X2), duplicate sheet header (M6) | S–M | **High** |
| 18 | **Chart rules** (§7.4): y-span floors, band labels in the margin, a legend per chart | S | High |
| 19 | **Tabbed "Soil & weather" card** (§7.3): Salinity · Moisture · NPK tabs on existing data, then Temperature and Rain after the Open-Meteo changes (§7.3, data changes 1–2, 5) | M | **High** |
| 20 | **Clutter-budget e2e test** (§2.4): turn `docs/ui-audit/audit.cjs` into `e2e/ui-budget.spec.ts`, which fails when controls, font sizes or tiny text exceed the budget | S | Med |
| 21 | Rain in the water balance (§7.3, data change 4) and NPK/heat-stress crop tables | M | Med |

**Suggested phases**

1. **Phase 1, calm the dashboard (about 3–4 days):** items 1–7, 17 and 18. There's no new data model,
   and it's the biggest visible change for the effort. Update the e2e tests in `e2e/dashboard.spec.ts` and
   `e2e/mobile.spec.ts` as controls move, and add item 20 so the gains can't quietly erode.
2. **Phase 2, AI split (about 1 week):** items 8, 10 and then 9. Ship the assistant route first
   using the extracted `ChatThread`, then add persistence and the sidebar. Insights launches with
   latest-only data.
3. **Phase 3, structure and charts (about 1–1.5 weeks):** items 11, 12 and 19. The details tabs and the
   tabbed chart card ship together, because the Trends tab *is* the chart card. Soil tabs first, then the
   weather tabs.
4. **Phase 4, depth:** items 13–16 and 21.

**How to verify each phase**: re-run `node docs/ui-audit/audit.cjs` and compare against the table in
§2.4. The "after" screenshots should show the KPIs above the fold at 1440×900 (D1), ≤ 15 controls in the first
screen, and on a phone the "What to do" card in the first screen (M1).

Implementation notes: this is Next.js 16.3 (`package.json`). `params` and `searchParams` are
Promises (as in `app/dashboard/page.tsx`), route protection lives in `proxy.ts` (not `middleware.ts`),
and pages use the generated `PageProps<"/route">` helper. Check `node_modules/next/dist/docs/` before
adding routes, layouts or intercepting routes. A shared `app/dashboard/layout.tsx` for the rail and
launcher would be new, since none exists yet.

---

## 10. Open questions

1. **Chat scope**: must every conversation belong to one farm (simplest, matches today's API), or do
   you want "All farms" portfolio chats in phase 2? *Recommendation: one farm per chat now, with the
   farm switchable mid-chat.*
2. **Privacy**: chats are private per user, but farms are visible to all signed-in users. Is that
   right, or should farms also get per-user or per-organisation ownership?
3. **Demo account**: should the shared demo user's chat history reset daily, or be per browser
   session, so visitors don't see each other's chats?
4. **Assistant as a route or an overlay**: route (recommended) vs an overlay that keeps the
   dashboard's live map state mounted behind it.
5. **Insights cadence**: does the AI service write insights daily or weekly? This decides whether
   the page says "This week" or "Today" and whether a risk sparkline is meaningful.
6. **"Mark done" for actions**: wanted? It requires per-user action state.
7. **Live mode**: is it a demo showpiece (keep it prominent on the landing page, tucked away in the app)
   or an operational feature (keep a visible indicator)?
8. **Dark mode and Arabic/RTL**: are either needed for Qatari users soon? RTL would affect the rail,
   the chat alignment and chart axes, so it's better planned before the restructure than after.
9. **Default layer**: is salinity the right default for every user, or should it follow the farm's
   top risk (moisture for a drying farm)? *The chart tabs (§7.3) recommend following the top risk. The map
   should do the same.*
10. **NPK targets**: which sufficiency ranges (mg/kg) should the NPK tab use per crop? There are no such
    targets in `lib/agronomy-tables.ts` today. Options: a published soil-test guide, the team's own
    agronomist, or no bands (trend only) until that's decided.
11. **Heat-stress thresholds**: same question for the Temperature tab's per-crop heat line (e.g. 35 °C
    for tomato and cucumber).
12. **Air vs soil temperature**: the brief asks for temperature "derived from online", so the tab leads with
    Open-Meteo air temperature and probe soil temperature is an overlay. Should soil temperature
    stay on the map as a layer at all?
13. **Rain tab in the dry season**: keep it as a full tab (with the empty state and the ETc-vs-rain
    line in §7.3), or merge it into Temperature as a combined "Weather" tab from May to October? *Recommendation: keep
    5 fixed tabs. Tabs that move around with the season are confusing.*
