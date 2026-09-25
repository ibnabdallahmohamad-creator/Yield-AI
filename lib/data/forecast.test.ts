import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNext12hForecasts, nextHours, nextRefreshAt, parseHourly, resetForecastCache, slotStart, summarize, type HourlyPoint } from "./forecast";

vi.mock("server-only", () => ({}));

const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);

/** Open-Meteo's hourly block for `count` hours from `fromMs`. */
function hourly(fromMs: number, count: number, temp = (i: number) => 30 + i) {
  const idx = Array.from({ length: count }, (_, i) => i);
  return {
    time: idx.map((i) => (fromMs + i * H) / 1000),
    temperature_2m: idx.map(temp),
    relative_humidity_2m: idx.map((i) => 60 - i),
    dew_point_2m: idx.map(() => 18),
    precipitation: idx.map((i) => (i === 3 ? 1.2 : 0)),
    precipitation_probability: idx.map((i) => (i === 3 ? 70 : 5)),
    wind_speed_10m: idx.map((i) => 3 + (i % 4)),
    wind_gusts_10m: idx.map((i) => 6 + (i % 5)),
    wind_direction_10m: idx.map(() => 0),
    weather_code: idx.map(() => 0),
    cloud_cover: idx.map(() => 10),
  };
}

function point(time: string, over: Partial<HourlyPoint> = {}): HourlyPoint {
  return { time, temp_c: null, humidity_pct: null, dew_point_c: null, precip_mm: null, precip_prob_pct: null, wind_ms: null, gust_ms: null, wind_dir_deg: null, weather_code: null, cloud_pct: null, ...over };
}

describe("refresh schedule", () => {
  it("runs at 00:00 and 12:00 Qatar time (21:00 and 09:00 UTC)", () => {
    expect(new Date(slotStart(at("2026-09-25T10:30:00Z"))).toISOString()).toBe("2026-09-25T09:00:00.000Z");
    expect(new Date(slotStart(at("2026-09-25T08:59:00Z"))).toISOString()).toBe("2026-09-24T21:00:00.000Z");
    expect(new Date(slotStart(at("2026-09-25T21:00:00Z"))).toISOString()).toBe("2026-09-25T21:00:00.000Z");
    expect(new Date(nextRefreshAt(at("2026-09-25T10:30:00Z"))).toISOString()).toBe("2026-09-25T21:00:00.000Z");
  });
});

describe("parseHourly / nextHours / summarize", () => {
  it("parses Open-Meteo's hourly block and keeps gaps as null", () => {
    const block = hourly(at("2026-09-25T09:00:00Z"), 2);
    block.temperature_2m[1] = null as unknown as number;
    const [first, second] = parseHourly(block);
    expect(first).toMatchObject({ time: "2026-09-25T09:00:00.000Z", temp_c: 30, humidity_pct: 60, wind_ms: 3, gust_ms: 6, wind_dir_deg: 0 });
    expect(second.temp_c).toBeNull();
  });

  it("shows the 12 hours from the current hour", () => {
    const hours = parseHourly(hourly(at("2026-09-25T08:00:00Z"), 36));
    const shown = nextHours(hours, at("2026-09-25T10:40:00Z"));
    expect(shown).toHaveLength(12);
    expect(shown[0].time).toBe("2026-09-25T10:00:00.000Z");
    expect(shown[11].time).toBe("2026-09-25T21:00:00.000Z");
  });

  it("summarises temperature, humidity, rain and wind", () => {
    const s = summarize(parseHourly(hourly(at("2026-09-25T09:00:00Z"), 12)));
    expect(s).toMatchObject({
      temp_min_c: 30,
      temp_max_c: 41,
      temp_max_at: "2026-09-25T20:00:00.000Z",
      humidity_min_pct: 49,
      humidity_max_pct: 60,
      rain_total_mm: 1.2,
      rain_hours: 1,
      rain_max_prob_pct: 70,
      wind_max_ms: 6,
      gust_max_ms: 10,
      wind_dir_deg: 0,
    });
  });

  it("averages wind direction as vectors (north-west and north-east make north)", () => {
    const s = summarize([point("2026-09-25T09:00:00Z", { wind_ms: 5, wind_dir_deg: 315 }), point("2026-09-25T10:00:00Z", { wind_ms: 5, wind_dir_deg: 45 })]);
    expect(s.wind_dir_deg).toBe(0);
    expect(summarize([point("2026-09-25T09:00:00Z")])).toMatchObject({ temp_max_c: null, wind_dir_deg: null, rain_total_mm: 0 });
  });
});

describe("getNext12hForecasts", () => {
  let dir: string;
  const farms = [{ id: "farm-a", lat: 25.68, lng: 51.5 }];
  const fetchMock = vi.fn();

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yai-forecast-"));
    vi.stubEnv("YIELD_DATA_DIR", dir);
    vi.stubEnv("OPEN_METEO_DISABLED", "false");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockReset();
    resetForecastCache();
  });

  afterEach(async () => {
    resetForecastCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const answer = (fromMs: number, temp?: (i: number) => number) => ({ ok: true, status: 200, json: async () => ({ hourly: hourly(fromMs, 36, temp) }) });

  it("downloads once per half-day and serves the next 12 hours from that copy", async () => {
    const morning = at("2026-09-25T09:05:00Z"); // 12:05 in Qatar
    fetchMock.mockResolvedValue(answer(at("2026-09-25T08:00:00Z")));

    const first = await getNext12hForecasts(farms, morning);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hourly")).toContain("wind_gusts_10m");
    expect(url.searchParams.get("forecast_hours")).toBe("36");
    expect(first["farm-a"]).toMatchObject({ source: "open-meteo", stale: false, next_refresh_at: "2026-09-25T21:00:00.000Z" });
    expect(first["farm-a"].hours).toHaveLength(12);
    expect(first["farm-a"].hours[0].time).toBe("2026-09-25T09:00:00.000Z");

    // Five hours later, same half-day: no download, the window has moved on.
    const later = await getNext12hForecasts(farms, morning + 5 * H);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(later["farm-a"].hours[0].time).toBe("2026-09-25T14:00:00.000Z");

    // Past 00:00 Qatar (21:00 UTC): a new download.
    fetchMock.mockResolvedValue(answer(at("2026-09-25T21:00:00Z"), () => 25));
    const night = await getNext12hForecasts(farms, at("2026-09-25T21:10:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(night["farm-a"].summary.temp_max_c).toBe(25);
    expect(night["farm-a"].next_refresh_at).toBe("2026-09-26T09:00:00.000Z");
  });

  it("keeps the previous forecast, marked stale, when a download fails, and retries after 10 minutes", async () => {
    fetchMock.mockResolvedValue(answer(at("2026-09-25T08:00:00Z")));
    await getNext12hForecasts(farms, at("2026-09-25T09:05:00Z"));

    fetchMock.mockRejectedValue(new Error("offline"));
    const midnight = at("2026-09-25T21:01:00Z");
    const stale = await getNext12hForecasts(farms, midnight);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stale["farm-a"].stale).toBe(true);
    expect(stale["farm-a"].hours[0].time).toBe("2026-09-25T21:00:00.000Z");

    await getNext12hForecasts(farms, midnight + 5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // not yet
    fetchMock.mockResolvedValue(answer(at("2026-09-25T21:00:00Z")));
    const fresh = await getNext12hForecasts(farms, midnight + 11 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fresh["farm-a"].stale).toBe(false);
  });

  it("survives a restart in the same half-day without downloading again", async () => {
    fetchMock.mockResolvedValue(answer(at("2026-09-25T08:00:00Z")));
    await getNext12hForecasts(farms, at("2026-09-25T09:05:00Z"));
    resetForecastCache(); // a new process: only the file in YIELD_DATA_DIR remains
    const again = await getNext12hForecasts(farms, at("2026-09-25T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again["farm-a"].hours).toHaveLength(12);
  });

  it("returns nothing (and never throws) when Open-Meteo is down and nothing is cached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await getNext12hForecasts(farms, at("2026-09-25T09:05:00Z"))).toEqual({});
  });
});
