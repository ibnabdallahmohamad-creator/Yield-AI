/**
 * A site's climate over the last full year from the Open-Meteo historical archive (ERA5 reanalysis,
 * free, no key): monthly ET₀ for crop water needs, summer heat, winter lows, humidity, wind and rain.
 * Cached in memory for a day per ~5 km cell. Falls back to typical Doha values when the archive is
 * unreachable, and says so. Never throws.
 */
import { addDays, QATAR_TIMEZONE } from "../data/time";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "relative_humidity_2m_mean",
  "wind_speed_10m_mean",
  "wind_speed_10m_max",
  "et0_fao_evapotranspiration",
  "precipitation_sum",
].join(",");
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 3600_000;
/** ERA5 reaches the archive about five days late. */
const ARCHIVE_LAG_DAYS = 6;
/** Days with a peak wind of 10 m/s or more at 10 m: blowing dust is likely. */
const DUST_WIND_M_S = 10;

export interface SiteClimate {
  source: "open-meteo-archive" | "typical";
  /** The year the figures cover (YYYY-MM-DD), or null for typical values. */
  period: { start: string; end: string } | null;
  elevation_m: number | null;
  et0_annual_mm: number;
  /** ET₀ per calendar month, January first, mm. */
  et0_monthly_mm: number[];
  /** Mean daily maximum, June–September, °C. */
  summer_tmax_mean_c: number;
  hottest_c: number;
  days_above_45c: number;
  /** Mean daily minimum, December–February, °C. */
  winter_tmin_mean_c: number;
  coldest_c: number;
  /** Mean relative humidity, June–September, %. */
  summer_humidity_mean_pct: number;
  wind_mean_m_s: number;
  dust_wind_days: number;
  rain_annual_mm: number;
  note: string | null;
}

/**
 * Typical values for Doha, used only when the archive is unreachable. Rounded long-term figures
 * (Qatar Meteorology Department climate normals; FAO CLIMWAT ET₀), for orientation, not design.
 */
export const TYPICAL_QATAR_CLIMATE: SiteClimate = {
  source: "typical",
  period: null,
  elevation_m: null,
  et0_annual_mm: 2110,
  et0_monthly_mm: [95, 110, 155, 190, 240, 260, 255, 235, 200, 165, 115, 90],
  summer_tmax_mean_c: 41,
  hottest_c: 47,
  days_above_45c: 5,
  winter_tmin_mean_c: 14,
  coldest_c: 8,
  summer_humidity_mean_pct: 50,
  wind_mean_m_s: 4,
  dust_wind_days: 20,
  rain_annual_mm: 75,
  note: "Live climate data was unavailable, so these are typical Doha values.",
};

interface ArchiveResponse {
  elevation?: number;
  daily?: {
    time: string[];
    temperature_2m_max: Array<number | null>;
    temperature_2m_min: Array<number | null>;
    relative_humidity_2m_mean: Array<number | null>;
    wind_speed_10m_mean: Array<number | null>;
    wind_speed_10m_max: Array<number | null>;
    et0_fao_evapotranspiration: Array<number | null>;
    precipitation_sum: Array<number | null>;
  };
}

const globalCache = globalThis as unknown as { __yieldClimateCache?: Map<string, { at: number; value: SiteClimate }> };
const cache = (globalCache.__yieldClimateCache ??= new Map());

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (v: number) => Math.round(v * 10) / 10;
const nums = (xs: Array<number | null>) => xs.filter((v): v is number => v != null && Number.isFinite(v));

/** Summarise one year of archive days. Exported for tests. */
export function summariseArchive(json: ArchiveResponse): SiteClimate | null {
  const d = json.daily;
  if (!d || d.time.length < 300) return null;
  const month = d.time.map((t) => Number(t.slice(5, 7)));
  const pick = (values: Array<number | null>, months: number[]) => nums(values.filter((_, i) => months.includes(month[i])));
  const monthly = Array.from({ length: 12 }, (_, m) => nums(d.et0_fao_evapotranspiration.filter((_, i) => month[i] === m + 1)));
  // Scale a month with missing days up to its full length so the annual total stays comparable.
  const et0Monthly = monthly.map((xs, m) => {
    const daysInMonth = new Date(Date.UTC(2025, m + 1, 0)).getUTCDate();
    return xs.length ? Math.round(mean(xs) * daysInMonth) : TYPICAL_QATAR_CLIMATE.et0_monthly_mm[m];
  });
  const tmax = nums(d.temperature_2m_max);
  const tmin = nums(d.temperature_2m_min);
  const windMax = nums(d.wind_speed_10m_max);
  if (tmax.length < 300 || tmin.length < 300) return null;
  return {
    source: "open-meteo-archive",
    period: { start: d.time[0], end: d.time[d.time.length - 1] },
    elevation_m: json.elevation ?? null,
    et0_annual_mm: et0Monthly.reduce((a, b) => a + b, 0),
    et0_monthly_mm: et0Monthly,
    summer_tmax_mean_c: r1(mean(pick(d.temperature_2m_max, [6, 7, 8, 9]))),
    hottest_c: r1(Math.max(...tmax)),
    days_above_45c: tmax.filter((t) => t >= 45).length,
    winter_tmin_mean_c: r1(mean(pick(d.temperature_2m_min, [12, 1, 2]))),
    coldest_c: r1(Math.min(...tmin)),
    summer_humidity_mean_pct: Math.round(mean(pick(d.relative_humidity_2m_mean, [6, 7, 8, 9]))),
    wind_mean_m_s: r1(mean(nums(d.wind_speed_10m_mean))),
    dust_wind_days: windMax.filter((w) => w >= DUST_WIND_M_S).length,
    rain_annual_mm: Math.round(nums(d.precipitation_sum).reduce((a, b) => a + b, 0)),
    note: null,
  };
}

/** The last full year of climate at a point in Qatar. `today` is YYYY-MM-DD (Asia/Qatar). */
export async function getSiteClimate(lat: number, lng: number, today: string): Promise<SiteClimate> {
  const key = `${(Math.round(lat * 20) / 20).toFixed(2)},${(Math.round(lng * 20) / 20).toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const end = addDays(today, -ARCHIVE_LAG_DAYS);
  const start = addDays(end, -364);
  const url =
    `${ARCHIVE_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${start}&end_date=${end}` +
    `&daily=${DAILY_VARS}&timezone=${encodeURIComponent(QATAR_TIMEZONE)}&wind_speed_unit=ms`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = summariseArchive((await res.json()) as ArchiveResponse);
    if (!summary) throw new Error("incomplete year");
    cache.set(key, { at: Date.now(), value: summary });
    return summary;
  } catch (error) {
    console.warn("[land] Climate archive unavailable:", error instanceof Error ? error.message : error);
    return TYPICAL_QATAR_CLIMATE;
  }
}
