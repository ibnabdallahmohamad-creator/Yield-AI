/**
 * A pretend ESP32 probe, speaking exactly the protocol of firmware/esp32/yield-ai-probe:
 *
 *   1. Pair: POST /api/device/pair { code } → { token, interval_s, ... }   (skipped with --token)
 *   2. Every interval_s: POST /api/readings with `Authorization: Bearer <token>` and one reading;
 *      the reply's `interval_s` sets the next wait, so changing it in the dashboard takes effect.
 *   3. When the server can't be reached, readings are buffered and sent later in one batch with
 *      their own timestamps (like the firmware's offline buffer).
 *
 * Usage:
 *   npm run device:sim -- --code ABCD-EFGH [--url http://localhost:3000]
 *   npm run device:sim -- --token yd_... [--url ...] [--count 20] [--backfill 6h]
 *
 * --backfill 6h first uploads 6 hours of history (one reading per interval) so the charts have
 * something to show straight away.
 */

interface Args {
  url: string;
  code: string | null;
  token: string | null;
  count: number;
  backfillMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const duration = (v: string | null) => {
    const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(v ?? "");
    if (!m) return 0;
    return Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "s" | "m" | "h" | "d"];
  };
  return {
    url: (get("url") ?? process.env.YIELD_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    code: get("code"),
    token: get("token") ?? process.env.DEVICE_TOKEN ?? null,
    count: Number(get("count") ?? Infinity),
    backfillMs: duration(get("backfill")),
  };
}

const FIRMWARE = "sim-1.0.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** A believable probe: moisture drains through the day and jumps after irrigation at 05:00 and 17:00 (Qatar). */
function reading(t: number, seed: number) {
  const qatarHour = ((t / 3_600_000 + 3) % 24 + 24) % 24;
  const sinceIrrigation = (qatarHour >= 17 ? qatarHour - 17 : qatarHour >= 5 ? qatarHour - 5 : qatarHour + 7) / 12;
  const noise = (k: number) => Math.sin(t / 97_000 + seed * 7.3 + k) * 0.5 + Math.sin(t / 13_000 + k * 3.1) * 0.5;
  const airTemp = 31 + 8 * Math.sin(((qatarHour - 9) / 24) * 2 * Math.PI) + noise(1) * 0.4;
  return {
    timestamp: new Date(t).toISOString(),
    moisture: round(27 - 9 * sinceIrrigation + noise(2) * 0.6, 1),
    temperature: round(24 + 5 * Math.sin(((qatarHour - 11) / 24) * 2 * Math.PI) + noise(3) * 0.2, 1),
    ec: round(1.6 + 0.35 * sinceIrrigation + noise(4) * 0.03, 3),
    ph: round(7.6 + noise(5) * 0.05, 2),
    n: Math.round(38 + noise(6) * 2),
    p: Math.round(21 + noise(7) * 1.5),
    k: Math.round(175 + noise(8) * 5),
    air_temp: round(airTemp, 1),
    air_humidity: Math.round(Math.max(8, Math.min(95, 55 - (airTemp - 31) * 3 + noise(9) * 2))),
  };
}

async function post(url: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let token = args.token;
  let interval = 10;

  if (!token) {
    if (!args.code) {
      console.error("Pass --code <pairing code> (from Farms & devices → Connect ESP32) or --token <device token>.");
      process.exit(1);
    }
    console.log(`Pairing with ${args.url} using code ${args.code}…`);
    const { status, json } = await post(`${args.url}/api/device/pair`, { code: args.code, firmware: FIRMWARE, ip: "192.168.1.77", rssi: -58 });
    if (status !== 200 || typeof json.token !== "string") {
      console.error(`Pairing failed (${status}): ${String(json.error ?? JSON.stringify(json))}`);
      process.exit(1);
    }
    token = json.token;
    interval = Number(json.interval_s) || interval;
    console.log(`Paired as ${String(json.name)} (${String(json.sensor_id)}) on farm ${String(json.farm_id)}; sending every ${interval} s.`);
    console.log(`Token (keep it to restart without pairing): ${token}`);
  }

  const ingest = `${args.url}/api/readings`;
  const seed = [...token].reduce((a, c) => a + c.charCodeAt(0), 0) % 100;

  if (args.backfillMs > 0) {
    const now = Date.now();
    const step = Math.max(interval * 1000, Math.ceil(args.backfillMs / 5000));
    const history = [];
    for (let t = now - args.backfillMs; t < now - step; t += step) history.push(reading(t, seed));
    for (let i = 0; i < history.length; i += 500) {
      const batch = history.slice(i, i + 500);
      const { status, json } = await post(ingest, { readings: batch, firmware: FIRMWARE, rssi: -60 }, token);
      console.log(`Backfill ${i + batch.length}/${history.length}: ${status} stored=${String(json.stored ?? 0)}${json.error ? ` ${String(json.error)}` : ""}`);
      if (status >= 400) break;
    }
  }

  const buffer: ReturnType<typeof reading>[] = [];
  for (let sent = 0; sent < args.count; sent++) {
    buffer.push(reading(Date.now(), seed));
    try {
      const body = buffer.length === 1 ? { ...buffer[0], firmware: FIRMWARE, rssi: -55 - Math.round(Math.random() * 10), ip: "192.168.1.77" } : { readings: buffer.slice(-500), firmware: FIRMWARE, rssi: -60 };
      const { status, json } = await post(ingest, body, token);
      if (status === 201) {
        const next = Number(json.interval_s);
        if (Number.isFinite(next) && next > 0 && next !== interval) {
          console.log(`Interval changed on the dashboard: ${interval} s → ${next} s`);
          interval = next;
        }
        console.log(`${new Date().toLocaleTimeString()} sent ${buffer.length} reading(s) → stored ${String(json.stored)}${Array.isArray(json.warnings) && json.warnings.length ? ` (${json.warnings.join(" ")})` : ""}`);
        buffer.length = 0;
      } else if (status === 401) {
        console.error(`The server refused the token (${String(json.error)}). Pair again with a new code.`);
        process.exit(1);
      } else if (status === 422) {
        console.warn(`The server rejected the reading(s): ${JSON.stringify(json.details ?? json.error)}; dropping them.`);
        buffer.length = 0;
      } else if (status === 429) {
        const wait = Number(json.retry_after_s ?? 5);
        console.warn(`Rate limited; waiting ${wait} s.`);
        await sleep(wait * 1000);
      } else {
        console.warn(`Server answered ${status}: ${String(json.error ?? "")}; keeping ${buffer.length} reading(s) for the next try.`);
      }
    } catch (error) {
      console.warn(`Can't reach ${args.url} (${error instanceof Error ? error.message : error}); buffering ${buffer.length} reading(s).`);
    }
    if (sent + 1 < args.count) await sleep(interval * 1000);
  }
}

void main();
