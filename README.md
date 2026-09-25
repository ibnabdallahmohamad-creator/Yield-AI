# Yield AI — the AI-powered CRM for agribusinesses

Yield AI turns soil-probe readings into salinity and moisture maps, risk scores and plain-language
actions: how much to irrigate, when to leach salts and what to plant next season. Farmers connect an
ESP32 with a 7-in-1 soil probe over Wi-Fi and watch its readings arrive live. Every number comes from
published agronomy (FAO-56 and FAO-29), with the method named next to it.

Everything is open source (MIT) and free, including the model. The app runs with **no keys at all**:
accounts and their farms are kept in a local store, the chat falls back to an offline agronomy
engine, and a shared demo account shows 8 built-in demo farms.

## What's inside

- **Landing page (`/`)** — three live widgets on the built-in demo data: a mini map, a 30-day chart
  and a mini chat with preset questions.
- **Accounts** — every user signs in. **A new account starts empty**: it never sees demo data, only
  the farms and devices it adds. Supabase Auth is used when configured; otherwise local accounts are
  stored in `.data/`. **Try the demo account** signs in with one click and shows the demo farms.
- **Farms & devices (`/dashboard/setup`)** — where a new account lands:
  - outline your field on satellite imagery and set its crop, planting date, soil and water salinity;
  - register an ESP32, place its probe in the field and get its device key (shown once);
  - download the firmware with your server address and key filled in (Wi-Fi details optional — they
    stay in the browser), follow the wiring table, and watch the status turn **Connected** the moment
    the device checks in;
  - pick the **reading interval** (5 s – 1 h, default **10 s**): how often the ESP32s report and the
    dashboard refreshes. Devices pick up a change with their next reading.
- **Dashboard (`/dashboard`)** — farms ranked by risk, the AI panel (risk, actions, crop suggestion)
  and the chat on every tab, and these tabs:
  - **Overview** — device status (online, signal, last values), the field map with interpolated probe
    layers (salinity, moisture, pH, temperature, NPK, ET₀, ETc, water deficit, yield loss), a 60-day
    time slider with a Then-vs-Now compare mode, headline numbers and a trend chart.
  - **Readings** — every probe reading over 1 h, 6 h, 24 h, 7 d, 30 d or 60 d: raw readings for the
    last hour, time-bucketed means beyond (~700 points per probe). One line per probe (fixed colours),
    the farm mean and the probe min–max band, crop / soil reference lines, drag-to-zoom, per-probe
    statistics, an all-readings small-multiples view, a table view and CSV export. Short ranges follow
    live updates.
  - **Weather, Temperature, Humidity, Rain, Wind** — the next 12 hours: a regional forecast map
    (smooth raster between forecast points, wind arrows, your farms on top, value under the cursor)
    with an hour slider, stat tiles, advisories (rain against irrigation, heat, spray windows,
    leaf-wetness hours, crop water use), hour-aligned charts, a wind rose, a comparison of your farms
    and an hour-by-hour table.
  - **AI insights** — a complete analysis of the farm by the AI model, split into sections (summary,
    irrigation, salinity, nutrients, weather, risks, actions…), plus the numbers behind it: key
    findings, 30-day trends with least-squares slopes, unusual days, a 30-day salinity outlook with
    projected yield loss, probe agreement, correlations and data quality.
  - **Live mode** polls at the reading interval (on by default for accounts; the demo feed is opt-in).
- **Farm details (`/dashboard/farm/[id]`)** — a field map, trend charts for all 11 layers, a per-probe
  table and every agronomy input (Kc, root depth, TAW/RAW, salt tolerance, leaching requirement…) with
  its source.

## Quick start

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Open Dashboard**. **Try the demo account** to explore the demo farms,
or **create an account** to add your own farm and connect an ESP32. No environment variables are
needed.

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop, build and serve the app |
| `npm test` | Unit tests (Vitest): FAO-56/FAO-29 maths, IDW, insights, stores, ingest, AI answer sections, weather, analytics, firmware |
| `npm run test:e2e` | End-to-end tests (Playwright): landing, accounts, connecting an ESP32, dashboard tabs, phone layout |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run data:summary` · `insights:preview` · `chat:preview` | Print the demo scenarios, rule-engine insights and offline chat answers in the terminal |

The first `npm run test:e2e` may need `npx playwright install chromium`. The tests start the dev
server with `USE_MOCK=true`, a throw-away data folder and a stand-in for the Open-Meteo API
(`e2e/fixtures/open-meteo.mjs`), or reuse a server already running on port 3000.

## Environment variables

Copy `.env.example` to `.env.local`. Every variable is optional.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. Without it (or the anon key), accounts and their data use the local store. |
| `SUPABASE_ANON_KEY` | Supabase anon (publishable) key, used for sign-in. `NEXT_PUBLIC_SUPABASE_*` names are also accepted. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. **Needed for ESP32 readings into Supabase** (devices aren't signed-in users) and the shared weather cache; also used for reads after the app's own sign-in check. |
| `USE_MOCK` | `true` keeps accounts' data in the local store even when Supabase is configured (sign-in can still use Supabase). |
| `LOCAL_DATA_DIR` | Folder of the local store and local accounts (default `.data`). |
| `AI_SERVICE_URL` | The team's fine-tuned model endpoint, the first stop for chat answers and the farm analysis (format below). |
| `AI_SERVICE_API_KEY` | Optional bearer token sent to `AI_SERVICE_URL`. |
| `ANTHROPIC_API_KEY` | The LLM key: Claude answers when the AI service is unset or failing. |
| `ANTHROPIC_MODEL` | LLM model, default `claude-opus-5`. |
| `AUTH_SECRET` | Signs local-account session cookies. **Set it in production** (`openssl rand -base64 32`). Without it, a key derived from `SUPABASE_SERVICE_ROLE_KEY` is used, and failing that a development default. |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | The shared demo account (defaults: `demo@yield-ai.app` / `harvest-demo-2026`). |
| `INGEST_API_KEY` | Enables bulk import into any farm through `POST /api/readings` (devices use their own keys). |
| `CRON_SECRET` | Enables `GET /api/cron/weather`, the 12-hourly forecast refresh for schedulers. |
| `LIVE_SIMULATION` | Demo account live feed: `auto`/`on` simulate readings, `off` keeps it quiet. Accounts only ever see real readings. |
| `OPEN_METEO_DISABLED` | `true` skips Open-Meteo: no forecast tabs, and ET₀ is estimated with Hargreaves. |
| `OPEN_METEO_BASE_URL` | Open-Meteo address (default `https://api.open-meteo.com`), e.g. a self-hosted instance. |

`GET /api/health` reports where account data lives, auth, device and bulk ingest, the chat chain and
the demo dataset.

## Supabase setup

1. Create a Supabase project and apply the migrations in order —
   `supabase/migrations/0001_init.sql`, then `0002_accounts_devices.sql` — with `npx supabase db push`
   or by pasting them into the SQL editor. Together they create:
   - `farms` (each owned by an account), `sensor_readings`, `ai_insights`, `devices` (ESP32s, with the
     SHA-256 of their key), `user_settings` (reading interval) and `app_cache` (weather forecast);
   - the `sensor_daily` view (daily means per probe, Asia/Qatar days) and the `readings_series`
     function (the readings explorer's time buckets);
   - row-level security: every account reads and writes only its own rows.

   `0002` also deletes the 8 demo farms an earlier `npm run seed` loaded — demo data now lives only in
   the app, for the demo account.
2. Put `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

If Supabase can't be reached, the dashboard says so and offers a retry — it never swaps in demo data.

## Connect an ESP32

**Hardware:** an ESP32 dev board, an RS485 (MAX485) module and a 7-in-1 soil probe (moisture,
temperature, EC, pH, N, P, K; Modbus RTU, usually 4800 baud, address 1).

| Wire | To |
| --- | --- |
| Probe brown / black | 12 V supply + / − (check your probe: 5–24 V); − also to ESP32 GND |
| Probe yellow / blue | RS485 A / B |
| RS485 RO / DI / DE+RE | ESP32 GPIO 16 / 17 / 4 |
| RS485 VCC / GND | ESP32 3.3 V / GND |

**Steps:** Farms & devices → add your farm → **Add ESP32** → **Download .ino** → Arduino IDE with
*esp32 by Espressif Systems*, board *ESP32 Dev Module* → upload. No extra libraries. If the Wi-Fi
details are missing or wrong, the ESP32 opens a hotspot **YieldAI-Setup-XXXX**; join it from a phone
and enter the Wi-Fi, the dashboard address and the device key (hold BOOT at power-up to open it
again). The dashboard address must be reachable from the ESP32 — your deployment, or this computer's
network address (e.g. `http://192.168.1.20:3000`) on the same Wi-Fi, not `localhost`.

The firmware ([`public/firmware/yield-ai-esp32/yield-ai-esp32.ino`](public/firmware/yield-ai-esp32/yield-ai-esp32.ino))
reads the probe, posts every reading, follows the reading interval the server sends back, keeps up
to 30 minutes of readings while Wi-Fi is down and sends them when it returns, and reports probe
faults (“probe not responding”) as a heartbeat so the dashboard can show them. The register map is
at the top of the sketch if your probe differs.

## Probe ingest — `POST /api/readings`

**ESP32 devices** send their own key, `Authorization: Bearer yai_…` (or `x-device-key`):

```bash
curl -X POST https://your-app.example.com/api/readings \
  -H "Authorization: Bearer $DEVICE_KEY" -H "Content-Type: application/json" \
  -d '{ "moisture": 10.4, "temperature": 28.1, "ec_us_cm": 1850, "ph": 8.1, "n": 31, "p": 19, "k": 132,
        "timestamp": 1790299800, "rssi": -61, "fw": "1.0.0" }'
```

- One measurement, or `{ "readings": [ … ] }` (up to 500, e.g. buffered while offline), plus the
  device's `rssi`, `fw` and an optional `error`. A body with no measurement is a heartbeat.
- The reading is stored under the device's farm and probe id at the probe's position.
- `timestamp` is ISO 8601 or Unix seconds/milliseconds, and defaults to the arrival time (a device
  whose clock never synced is treated the same way).
- Reply: `{ "ok": true, "stored": 1, "interval_s": 10, "server_time": "…", "device": { … } }`. Devices
  follow `interval_s`. A device posting faster than every 2 s gets `429` with `interval_s`.

**Bulk import** with the server-wide `INGEST_API_KEY` takes one reading, an array or
`{ "readings": [...] }` (up to 1000), each with `farm_id` and `sensor_id`.

| Field | Unit / behaviour |
| --- | --- |
| `moisture` | % VWC |
| `temperature` | °C |
| `ec` | dS/m (= mS/cm) |
| `ec_us_cm` | µS/cm, as most 7-in-1 probes report it |
| `n`, `p`, `k` | mg/kg |
| `air_temp`, `air_humidity` | Optional mast sensor |

In the local store, readings keep full resolution for 48 hours, then one per probe every 10 minutes,
for 120 days — a device reporting every 10 s stays at a few MB.

## Weather — every 12 hours

The app fetches an hourly forecast from [Open-Meteo](https://open-meteo.com) (free, no key) for every
farm and a grid of points around them: temperature, feels-like, dew point, humidity, rain and its
chance, wind speed, direction and gusts, cloud cover, radiation, ET₀, VPD and the weather code. Each
fetch covers the next 24 hours and is cached for 12 hours (in Supabase's `app_cache` or the local
store), so the next 12 hours are always there and every server instance serves the same forecast.
It is refreshed:

- when someone opens it more than 12 hours after the last fetch;
- every 12 hours by long-running servers (`next start`, `next dev`; see `instrumentation.ts`);
- by `GET /api/cron/weather` with `Authorization: Bearer $CRON_SECRET` — for serverless deployments,
  point any scheduler at it (on Vercel Pro, a `vercel.json` cron of `0 */12 * * *`; the Hobby plan
  only allows daily cron jobs, where the refresh-on-open above covers it).

If Open-Meteo can't be reached, the last forecast is shown and marked as such; nothing is invented.
The chat and the farm analysis also receive the forecast, so the AI can answer “will it rain?”.

## AI integration

All AI formats live in one typed file, [`lib/ai/contract.ts`](lib/ai/contract.ts). Change a shape there
and TypeScript points at every place that needs updating.

### Insights — rows in `ai_insights`

The AI service writes one row per farm whenever it has a new assessment. The dashboard shows the
latest row per farm and ranks farms by `risk_score`. `id` and `created_at` default in the database.

```json
{
  "farm_id": "khor-north",
  "risk_score": 82,
  "risk_level": "high",
  "summary": "ECe rose from 3.5 to 5.9 dS/m in 30 days (+67%) — moderately saline and above the 2.5 dS/m tomato threshold, so the predicted yield loss is 33%.",
  "recommendations": [
    {
      "title": "Apply a leaching irrigation (+17% water)",
      "detail": "Irrigate 13 mm instead of 11 mm at the next cycle (FAO-29 Eq. 7, 90% yield target).",
      "priority": "high"
    },
    { "title": "Inspect the north-east hotspot around KN-02", "detail": "", "priority": "high" }
  ],
  "crop_suggestion": {
    "crop": "Zucchini",
    "reason": "Tolerates ECe up to 4.7 dS/m (FAO-29 Table 4).",
    "market_note": "Oversupplied in Qatar during the peak season — stagger planting."
  }
}
```

| Field | Rules |
| --- | --- |
| `risk_score` | 0–100 |
| `risk_level` | `low`, `medium` or `high` |
| `priority` | `high`, `medium` or `low` |
| `recommendations` | Shown in priority order |
| `crop_suggestion` | May be `null` |

Rows that don't validate are skipped, never shown broken.

Until the model writes a row for a farm, its insight comes from a transparent rule engine,
[`lib/data/insights.ts`](lib/data/insights.ts), computed from that farm's own readings (and labelled as
such). It blends predicted yield loss (Maas–Hoffman), the 30-day ECe trend and FAO-56 water stress (Ks)
into the score: 70+ is high, 40–69 medium, below 40 low. It's a baseline for the fine-tuned model to beat.

### Chat — `POST /api/chat`

Browser → server (requires a signed-in session):

```json
{
  "farm_id": "khor-north",
  "question": "Why is salinity rising?",
  "date": "2026-09-24",
  "history": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }]
}
```

`date` (`YYYY-MM-DD`, the day on screen) and `history` (up to 12 turns) are optional. Server → browser:

```json
{
  "farm_id": "khor-north",
  "answer": "**Salinity at Al Khor North Farm:** ECe is 5.9 dS/m …",
  "source": "ai-service",
  "model": "yield-ai",
  "created_at": "2026-09-24T09:12:03.000Z"
}
```

`source` is `ai-service`, `llm` or `offline`, and the chat labels every answer with it. Answers are
tried in this order, stopping at the first one that responds:

1. **`AI_SERVICE_URL`** — the server POSTs `{ farm_id, question, context, history }` and expects
   `{ "answer": "…" }` back (`response`, `text` or `message` are accepted too, plus optional
   `confidence` and `sources`). `context` is the `ChatContext` in `contract.ts`: farm settings, the
   latest per-probe readings, 30-day trends, every FAO-56/FAO-29 derived value with its method, and
   `forecast_next_12h` (the 12-hour forecast summary and advisories). Timeout 20 s;
   `Authorization: Bearer $AI_SERVICE_API_KEY` if set.
2. **LLM fallback** — Claude through the official Anthropic SDK (`ANTHROPIC_API_KEY`), with the same
   context and the system prompt *"You are an agronomist assistant for farms in Qatar. Be concise and
   practical. Reference the farm's actual readings."*
3. **Offline engine** — [`lib/ai/offline.ts`](lib/ai/offline.ts) answers from the context alone.
   Topics: salinity, irrigation, crop choice, pH, nutrients, weather, temperature, ET, yield and
   hotspots. The chat therefore always answers with the farm's real numbers.

### Farm analysis — `GET /api/analysis?farm=…`

The AI insights tab asks the same chain for a complete analysis (`ANALYSIS_QUESTION` in
`contract.ts`) and caches it for 30 minutes per farm and day (`&refresh=1` asks again).

### Answers split into sections — no AI needed

Whatever the model returns — Markdown, plain paragraphs or JSON — is split into sections (summary,
diagnosis, actions, irrigation, salinity, nutrients, crop, weather, risks, monitoring, readings) by
fixed rules in [`lib/ai/sections.ts`](lib/ai/sections.ts): Markdown headings, bold or `Title:` labels,
ALL-CAPS or numbered section titles, JSON keys, and otherwise the structure of the text (the opening
paragraph, lists of instructions, and paragraphs or sentences classified by topic). The chat and the
AI insights tab show them as titled sections; short answers stay as they are.

## The science

Every coefficient is copied from a published table and cited in a comment next to the value in
[`lib/agronomy-tables.ts`](lib/agronomy-tables.ts). Nothing is tuned or invented. The formulas live in
[`lib/agronomy.ts`](lib/agronomy.ts). In the UI, each derived value shows its unit and an info tooltip
naming the method.

| What | Method |
| --- | --- |
| Reference ET₀ | FAO-56 Penman–Monteith (Eq. 6), from Open-Meteo daily weather (wind converted to 2 m, Eq. 47) |
| ET₀ fallback | FAO-56 Hargreaves (Eq. 52) when weather is missing; labelled "estimated (Hargreaves)" |
| ET₀ cross-check | Open-Meteo's own FAO ET₀, drawn as a dashed line |
| Crop coefficient Kc | FAO-56 Table 12 with stage lengths from Table 11; Kc mid/end adjusted for climate (Eq. 62, 65) |
| Soil water | TAW = 1000 (θFC − θWP) Zr (Eq. 82) and RAW = p·TAW (Eq. 83), with θ from Table 19 and Zr, p from Table 22 (p adjusted for ETc) |
| Water balance | Root-zone depletion from probe moisture, and days to the next irrigation |
| Water stress | Ks (Eq. 84) |
| Soil salinity | ECe estimated from probe bulk EC with a per-farm calibration factor fitted from lab saturated-paste samples |
| Yield loss | Maas–Hoffman threshold–slope model: Yr = 100 − b (ECe − a) (FAO-29 Table 4; FAO-61 for eggplant) |
| Leaching requirement | LR = ECw / (5·ECe − ECw) (FAO-29 Eq. 7), with target ECe at 90% relative yield |
| Salinity classes | Non-saline < 2, slightly 2–4, moderately 4–8, strongly 8–16, very strongly > 16 dS/m (ECe) |
| Field maps | Inverse-distance weighting, power 2, on 5 m cells, clipped to the field polygon |
| Trends and outlook | Least-squares slope over 14 days (R² shown); a day is unusual at ≥ 3 σ from its trend; ECe projected 30 days ahead with the Maas–Hoffman yield loss |
| Wind classes | Beaufort scale; spray window: wind < 3 m/s, gusts < 5 m/s and no rain |

> **Note on "Maas–Hanson":** the project brief mentions a "Maas–Hanson" model. The salinity
> threshold–slope model in FAO-29 is **Maas & Hoffman (1977)**, so that is what Yield AI implements
> and cites.

The crop market notes (e.g. "oversupplied in Qatar during the peak season") are illustrative signals
set in `lib/agronomy-tables.ts`. Replace them with your own market data.

## Demo tips

- **Projector or second screen:** the layouts are tuned for 1280×720 up to 1920×1080. Phones get a
  farm sheet, a layer menu and scrolling tabs.
- **Phones on the same Wi-Fi:** `npm run dev` prints a Network URL (e.g. `http://192.168.1.11:3000`).
  Open it on the phone — and use it as the ESP32's dashboard address. Private network ranges are
  already allowed in `next.config.ts` (`allowedDevOrigins`).
- **Demo live mode** simulates probe readings for the demo farms (`LIVE_SIMULATION=auto`), so the demo
  is never idle. Real accounts only ever see their devices' readings.

## Project layout

```text
app/                     routes: landing, (auth), dashboard, dashboard/setup, dashboard/farm/[id], api/*
components/dashboard/    shell and tabs, map (Leaflet + IDW raster), charts (Recharts), readings explorer, AI panel, chat
components/setup/        farms & devices: field outline and probe maps, ESP32 connection guide
components/weather/      forecast tabs and the regional forecast map
components/insights/     the AI insights tab
lib/agronomy*.ts         FAO-56 / FAO-29 formulas and cited tables
lib/ai/                  contract.ts (all AI formats), chat context, answer chain, sections, offline engine
lib/data/                repository (demo vs account data), demo generator, derivation, ingest, series
lib/store/               account data: Supabase and local (.data/) stores
lib/weather/             Open-Meteo forecast, 12-hourly refresh, advisories, map scales
lib/analytics.ts         trends, anomalies, correlations and the salinity outlook
public/firmware/         the ESP32 sketch
supabase/migrations/     database schema and row-level security
scripts/                 preview scripts
e2e/                     Playwright tests (and the Open-Meteo stand-in)
```

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, react-leaflet, Recharts,
Supabase, Zod, the Anthropic SDK, Vitest and Playwright.

Map tiles: © Esri, Maxar, Earthstar Geographics (satellite) and © OpenStreetMap contributors, © CARTO
(streets). Weather: [Open-Meteo](https://open-meteo.com).

## License

[MIT](LICENSE)
