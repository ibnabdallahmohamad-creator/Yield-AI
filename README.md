# Yield AI — the AI-powered CRM for agribusinesses

Yield AI turns soil-probe readings from farms in northern Qatar into salinity and moisture maps, risk
scores and plain-language actions: how much to irrigate, when to leach salts and what to plant next
season. Every number comes from published agronomy (FAO-56 and FAO-29), with the method named next
to it.

Everything is open source (MIT) and free, including the model. The app runs with **no keys at all**:
it falls back to a built-in demo dataset, local accounts and an offline agronomy engine, so the demo
never breaks.

## What's inside

- **Landing page (`/`)** — three live widgets built from the dashboard's own components, on demo data:
  - a mini map: click a farm to see its risk and top insight;
  - a 30-day chart that toggles between moisture, salinity and pH;
  - a mini chat with three preset questions whose answers type out.
- **Dashboard (`/dashboard`)**
  - Farms ranked by AI risk score.
  - A satellite or street map with a layer switcher: salinity, moisture, pH, temperature and NPK, plus
    derived layers (ET₀, ETc, water deficit, predicted yield loss). Each layer has a legend with its
    class thresholds.
  - Probe values are interpolated across each field (IDW).
  - A 60-day time slider, and a **Then vs Now** compare mode with a change badge per farm
    (e.g. "ECe +18%").
  - Charts with class bands and crop thresholds, a 7/30/60-day range, and an overlay of the previous
    period or another farm.
  - An AI panel with the risk, a summary, prioritised actions and a crop suggestion with a market
    note, plus a chat grounded in the farm's readings.
  - **Next 12 hours** — hourly temperature, humidity, rain (amount and chance), wind with its
    direction and gusts, downloaded again every 12 hours (00:00 and 12:00 Qatar time).
  - **Live mode** checks for new readings at the account's reading interval (every **10 s** by
    default; 5 s to 15 min, set under the status dot → *Update every*) and pulses the farm that just
    reported.
- **Farm details (`/dashboard/farm/[id]`)**
  - A field map, KPIs and the 12-hour forecast.
  - Trend charts for all 11 layers, each over 30 or 60 days.
  - **Probes** — a per-probe table for the selected day, and **every reading** the devices sent
    (`?tab=readings` opens it), from the last hour to all time: moisture, soil temperature, EC, pH,
    N, P, K, air temperature and humidity. Farm mean with the probe range, or one line per probe;
    drag across the chart (or use the zoom buttons) to zoom in; min / mean / max per point in the
    tooltip; latest, average, lowest, highest and change; a table view and a CSV download.
  - Every agronomy input (Kc, root depth, TAW/RAW, salt tolerance, leaching requirement…) with its
    source.
- **Farms & devices (`/dashboard/devices`)** — add farms (click the satellite map, type coordinates or
  use the phone's GPS), connect ESP32 probes with a pairing code, and see each device's status,
  signal, last reading and reading interval.
- **Accounts** — every user signs in. Supabase Auth is used when configured; otherwise local accounts
  are stored in `.data/`. A **Try the demo account** button signs in with one click.

The landing page and the demo account show the built-in demo dataset. **A new account starts empty —
no demo data**: its dashboard shows only the farms it adds and the readings its own ESP32 devices send.

## Quick start

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Open Dashboard** → **Try the demo account**. No environment variables
are needed for the demo.

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop, build and serve the app |
| `npm test` | Unit tests (Vitest): FAO-56/FAO-29 maths, IDW, insights, ingest, sessions |
| `npm run test:e2e` | End-to-end tests (Playwright): landing widgets, sign-in, dashboard, farm details, phone layout |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run seed` | Load the demo farms, 60 days of readings and insights into Supabase |
| `npm run device:sim -- --code ABCD-EFGH` | A simulated ESP32: pairs with a code from *Farms & devices* and sends readings at the dashboard's interval (`--backfill 6h` uploads history first; `--token yd_…` reuses a paired device) |
| `npm run data:summary` · `insights:preview` · `chat:preview` | Print the demo scenarios, seed insights and offline chat answers in the terminal |

The first `npm run test:e2e` may need `npx playwright install chromium`. The tests start the dev
server with `USE_MOCK=true`, or reuse one that is already running on port 3000.

## Environment variables

Copy `.env.example` to `.env.local`. Every variable is optional.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. Without it (or the anon key), the app uses the demo data and local accounts. |
| `SUPABASE_ANON_KEY` | Supabase anon (publishable) key, used for sign-in. `NEXT_PUBLIC_SUPABASE_*` names are also accepted. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Data reads after the app's own sign-in check, probe ingest and `npm run seed`. Without it, reads use the signed-in user's Supabase session. |
| `USE_MOCK` | `true` shows the built-in demo data even when Supabase is configured. |
| `AI_SERVICE_URL` | The team's fine-tuned model endpoint, the first stop for chat answers (format below). |
| `AI_SERVICE_API_KEY` | Optional bearer token sent to `AI_SERVICE_URL`. |
| `ANTHROPIC_API_KEY` | The LLM key: Claude answers when the AI service is unset or failing. |
| `ANTHROPIC_MODEL` | LLM model, default `claude-opus-5`. |
| `AUTH_SECRET` | Signs local-account session cookies. **Set it in production** (`openssl rand -base64 32`). Without it, a key derived from `SUPABASE_SERVICE_ROLE_KEY` is used, and failing that a development default. |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | Credentials behind "Try the demo account" (defaults: `demo@yield-ai.app` / `harvest-demo-2026`). |
| `INGEST_API_KEY` | A shared key for sending readings to the **demo farms** with `POST /api/readings`. Not needed for accounts' ESP32 devices, which get their own token when they pair. |
| `LIVE_SIMULATION` | Demo account's live feed: `auto` (default) simulates readings when no real ones arrive; `on` or `off`. Real accounts only ever see their devices' readings. |
| `OPEN_METEO_DISABLED` | `true` skips Open-Meteo. ET₀ is then estimated with Hargreaves and there is no 12-hour forecast. |
| `CRON_SECRET` | Enables `GET /api/cron/weather` (the 12-hour forecast refresh) for hosts that run scheduled jobs. |
| `YIELD_DATA_DIR` | Where local accounts, their farms, devices and readings, saved chats and the forecast cache are stored (default `.data/`). |

Check what is active at `GET /api/health`, which reports the data source, auth, chat chain, ingest,
live mode and the 12-hour forecast.

## Supabase setup

1. Create a Supabase project. Apply `supabase/migrations/0001_init.sql`, either with
   `npx supabase db push` or by pasting it into the SQL editor. It creates:
   - the tables `farms`, `sensor_readings` and `ai_insights`;
   - a `sensor_daily` view (daily means per probe, Asia/Qatar days);
   - row-level security (only signed-in users can read).

   Then apply, in order:
   - `0002_conversations.sql` — saved chats (`conversations` and `messages`, private to each user
     through row-level security);
   - `0003_insight_sections.sql` — the report sections of `ai_insights`;
   - `0004_accounts_devices.sql` — accounts' own farms (`farms.owner_id`), the `devices` table (ESP32
     probes: pairing codes, hashed tokens, interval, last seen) and `reading_series()`, which buckets
     readings in the database for the Readings chart. Each account sees only its own farms, devices
     and readings; the seeded demo farms (no owner) are shown to the demo account only.
2. Put `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
3. Run `npm run seed`. It loads:
   - 8 farms in northern Qatar;
   - 60 days of 3-hourly readings from 4–6 probes per farm, with the 60-day window ending today (re-run it to move the window forward);
   - one insight per farm;
   - the demo account.

   In the demo data, two farms have rising salinity, one is drying out, and the rest are healthy.

If Supabase is unreachable, the dashboard falls back to the demo data and shows a "Demo data · offline"
badge instead of an error.

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

The seed insights (and the insights in demo mode) come from a transparent rule engine,
[`lib/data/insights.ts`](lib/data/insights.ts). It blends predicted yield loss (Maas–Hoffman), the
30-day ECe trend and FAO-56 water stress (Ks) into the score: 70+ is high, 40–69 medium, below 40 low.
It's a baseline for the fine-tuned model to beat.

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
   latest per-probe readings, 30-day trends, and every FAO-56/FAO-29 derived value with its method.
   Timeout 20 s; `Authorization: Bearer $AI_SERVICE_API_KEY` if set.
2. **LLM fallback** — Claude through the official Anthropic SDK (`ANTHROPIC_API_KEY`), with the same
   context and the system prompt *"You are an agronomist assistant for farms in Qatar. Be concise and
   practical. Reference the farm's actual readings."*
3. **Offline engine** — [`lib/ai/offline.ts`](lib/ai/offline.ts) answers from the context alone.
   Topics: salinity, irrigation, crop choice, pH, nutrients, temperature, ET, yield, hotspots, the
   next 12 hours and the week's weather, costs, harvest and the farm's location. The chat therefore
   always answers with the farm's real numbers.

`context.weather_next_12h` carries the hourly forecast (temperature, humidity, rain, wind and gusts
with direction) so every answerer can talk about the next hours.

**Answers are split into sections by the website, with no AI involved**
([`lib/ai/sections.ts`](lib/ai/sections.ts)). Whatever the answer looks like, the chat shows a lead
line and titled sections (Warnings, Do now, Next 12 hours, Recommendations, Sources…), with priority
badges, numbered steps and collapsible sources:

- the fine-tuned model's JSON (`summary`, `insights`, `warnings`, `forecast`, `economic_advice`,
  `recommendations`, `crop_plan`, `sources`, `data_gaps`) — also inside a ```` ```json ```` fence,
  surrounded by text, double-encoded, with trailing commas, or cut off mid-answer;
- the report JSON (`contract.ts` `FarmReport`), or any other JSON object (one section per key);
- Markdown or plain text: `### Heading` lines, whole-line **bold** labels or `Warnings:`-style labels
  start sections.

Copying an answer gives clean Markdown, and the chat history previews its first line.

### Saved chats — `/api/conversations`

`POST /api/chat` also takes optional `conversation_id` (append to a saved chat; the server loads the
last 12 turns itself and ignores `history`), `new_conversation: true` (start one, titled after the
question), `insight_id` (stored on the question) and `regenerate: true` (with `conversation_id`:
answer the last question again, replacing the reply). The response then adds `conversation_id`,
`conversation`, `user_message` and `message`. Without those fields the chat stays stateless and
`conversation_id` is `null`. If saving fails, the answer is still returned.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /api/conversations?farm=&q=` | — | `{ conversations }`, newest first, at most 200. `q` searches titles and messages |
| `POST /api/conversations` | `{ farm_id, title? }` | `201 { conversation }` |
| `GET /api/conversations/[id]` | — | `{ conversation, messages }`, oldest message first |
| `PATCH /api/conversations/[id]` | `{ title?, pinned?, farm_id? }` | `{ conversation }` |
| `DELETE /api/conversations/[id]` | — | `{ ok: true }` |
| `PATCH /api/conversations/[id]/messages/[messageId]` | `{ feedback: "up" \| "down" \| null }` | `{ message }` |

All of them need a signed-in session (401 otherwise) and answer `{ error }` with 400 (bad body), 404
(not yours or deleted) or 503 (storage unreachable). The shapes are in section 7 of `contract.ts`, and
[`lib/chat/client.ts`](lib/chat/client.ts) has typed fetch helpers for the browser. Supabase users
are stored in the `0002_conversations.sql` tables. Local accounts use one JSON file per user in
`.data/conversations/` (memory only on read-only hosts). The shared demo account gets a separate
history per sign-in, and those files are deleted after 7 days.

## ESP32 devices

Each account connects its own ESP32 probes over Wi-Fi. No keys to copy by hand:

1. **Farms & devices → Add farm**, then **Connect ESP32**. Pick the farm, name the device and choose
   how often it sends a reading (10 s by default). The dashboard shows an 8-character **pairing code**
   (valid 30 minutes) and the server address to use.
2. **Flash the firmware** in [`firmware/esp32/yield-ai-probe`](firmware/esp32/yield-ai-probe) (see its
   README). On first boot the ESP32 opens a Wi-Fi hotspot, `YieldAI-Setup-XXXX`. Join it with a phone:
   the setup page lists nearby networks. Enter your Wi-Fi, the server address and the pairing code.
3. The device pairs, receives its own token, and starts sending readings. The dashboard follows along:
   *Waiting for the device → Paired → Receiving readings*.

No hardware yet? `npm run device:sim -- --code ABCD-EFGH` is a simulated ESP32 that speaks the same
protocol. On `localhost`, the connect dialog shows the computer's LAN address, which a real device on
the same Wi-Fi can reach.

**Reading interval.** Each device sends a reading every `interval_s` seconds (5 s to 1 hour; 10 s by
default). Change it per device on *Farms & devices*, or for every device at once under the status dot
→ *Update every*. The device learns the new value from its next ingest reply, and the dashboard checks
for new readings at the same pace.

### Protocol

| Step | Request | Reply |
| --- | --- | --- |
| Pair | `POST /api/device/pair` `{ "code": "ABCD-EFGH", "firmware"?, "mac"?, "ip"?, "rssi"? }` (no auth) | `200 { token: "yd_…", interval_s, ingest_url, farm_id, sensor_id, name }` · `404` code invalid or expired · `429` too many attempts |
| Send | `POST /api/readings` with `Authorization: Bearer yd_…` | `201 { stored, interval_s, server_time, warnings?, rejected? }` |

The body is one reading, an array, or `{ "readings": [...], "rssi"?, "firmware"?, "ip"? }` (at most
500 readings, e.g. a buffer saved while Wi-Fi was down). No farm or probe ids: the token says which
device it is.

```json
{ "timestamp": 1790313600, "moisture": 21.4, "temperature": 27.9, "ec_us_cm": 1850, "ph": 7.8,
  "n": 38, "p": 21, "k": 175, "air_temp": 36.2, "air_humidity": 31 }
```

- Every measurement is optional, but send at least one. Units as in the table below; common sketch
  names are also accepted (`soil_moisture`, `soil_temp`, `nitrogen`, `humidity`…).
- `timestamp` is Unix seconds (or ms) or ISO 8601 with an offset. Without a clock, send `age_s`
  (seconds since the reading was taken) or nothing (now). A timestamp before 2024 (a clock that was
  never set) or in the future is replaced by the time received, with a warning; readings older than
  30 days are refused.
- Errors: `401` unknown token (pair again), `422` invalid readings (`details` says which; drop them),
  `429` more than 30 requests a minute (wait `retry_after_s`), `503` storage unavailable (keep the
  buffer and retry). Every reply includes `interval_s`.

Charts read the readings back with `GET /api/readings/series?farm=<id>&range=1h|6h|24h|7d|30d|90d|all`
(or `&from=<ISO>&to=<ISO>`), bucketed with mean, min, max and count per metric, farm-wide and per
probe, so they stay fast however often the devices report.

## Weather

- **Daily weather** (past 60 days and a 7-day forecast) from Open-Meteo drives FAO-56 ET₀ and the
  week's outlook.
- **The next 12 hours**, hour by hour: temperature, humidity, dew point, rain (mm and chance), wind
  speed, gusts and direction, weather code. The forecast is downloaded every 12 hours on a fixed
  schedule, **00:00 and 12:00 Qatar time**, for the next 36 hours. Between downloads the app shows the
  12 hours from the current hour. Downloads are cached in memory and in
  `.data/weather/forecast.json`, and a failed download keeps the previous forecast (marked stale) and
  retries every 10 minutes.
- Refresh triggers: on a long-running server (`next start`, `next dev`), `instrumentation.ts` runs
  the refresh at each 00:00 and 12:00. Serverless hosts refresh on the first request in each half-day,
  or from a scheduled `GET /api/cron/weather` with `Authorization: Bearer $CRON_SECRET` (cron
  `0 9,21 * * *` UTC).

## Probe ingest for the demo farms — `POST /api/readings`

The hardware team can also send readings to the **demo farms** with a shared key. Send one reading,
an array, or `{ "readings": [...] }` (up to 1000), with `Authorization: Bearer $INGEST_API_KEY` or an
`x-api-key` header:

```bash
curl -X POST http://localhost:3000/api/readings \
  -H "Authorization: Bearer $INGEST_API_KEY" -H "Content-Type: application/json" \
  -d '{ "farm_id": "khor-north", "sensor_id": "KN-01", "timestamp": "2026-09-24T09:00:00+03:00",
        "moisture": 10.4, "temperature": 28.1, "ec_us_cm": 1850, "ph": 8.1, "n": 31, "p": 19, "k": 132 }'
```

Units and defaults:

| Field | Unit / behaviour |
| --- | --- |
| `moisture` | % VWC |
| `temperature` | °C |
| `ec` | dS/m (= mS/cm) |
| `ec_us_cm` | µS/cm, as most 7-in-1 probes report it |
| `n`, `p`, `k` | mg/kg |
| `air_temp`, `air_humidity` | Optional mast sensor |
| `timestamp` | Defaults to now |
| `lat`, `lng` | Default to the probe's known position |

Readings go to Supabase, or to the in-memory demo store in mock mode. Live mode shows them at its next check (every 10 s by default).

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

> **Note on "Maas–Hanson":** the project brief mentions a "Maas–Hanson" model. The salinity
> threshold–slope model in FAO-29 is **Maas & Hoffman (1977)**, so that is what Yield AI implements
> and cites.

The crop market notes (e.g. "oversupplied in Qatar during the peak season") are illustrative demo
signals set in `lib/agronomy-tables.ts`. Replace them with your own market data.

## Demo tips

- **Projector or second screen:** the layouts are tuned for 1280×720 up to 1920×1080. Phones get a
  farm sheet and a layer menu.
- **Phones on the same Wi-Fi:** `npm run dev` prints a Network URL (e.g. `http://192.168.1.11:3000`).
  Open it on the phone. Private network ranges are already allowed in `next.config.ts` (`allowedDevOrigins`).
- **Live mode** simulates probe readings when none are arriving (`LIVE_SIMULATION=auto`), so the
  demo is never idle.

## Project layout

```text
app/                    routes: landing, (auth) login/signup, dashboard (overview, insights, farm/[id],
                        land, assistant, devices), api/*
components/dashboard/   map (Leaflet + IDW raster), charts (Recharts), timeline
components/charts/      soil & weather charts, the next-12-hours forecast card
components/farm/        farm details: readings explorer, probes, method
components/devices/     farms & devices: add farm, connect ESP32 (pairing), device list
components/assistant/   the chat, including the section renderer for answers
components/landing/     the three landing-page demo widgets (built on the dashboard components)
lib/agronomy*.ts        FAO-56 / FAO-29 formulas and cited tables
lib/account/            accounts' farms and devices: pairing, device ingest, local and Supabase stores
lib/readings/           bucketing readings into chart series
lib/ai/                 contract.ts (all AI formats), chat context, AI-service / LLM / offline answers,
                        sections.ts (splits any answer into sections without AI)
lib/chat/               saved chats: Supabase and local-file stores, browser API client
lib/data/               demo data generator, Supabase source, daily aggregation, insights, live mode,
                        weather and the 12-hour forecast
firmware/esp32/         the ESP32 probe sketch (Wi-Fi setup page, pairing, offline buffer)
supabase/migrations/    database schema and row-level security
scripts/                seed, preview and ESP32 simulator scripts
e2e/                    Playwright tests
```

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, react-leaflet, Recharts,
Supabase, Zod, the Anthropic SDK, Vitest and Playwright.

Map tiles: © Esri, Maxar, Earthstar Geographics (satellite) and © OpenStreetMap contributors, © CARTO
(streets). Weather: [Open-Meteo](https://open-meteo.com).

## License

[MIT](LICENSE)
