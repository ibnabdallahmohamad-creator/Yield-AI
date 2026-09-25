/**
 * Daily weather for the dataset: the same Open-Meteo variables the app reads live (lib/data/weather.ts),
 * taken from the Open-Meteo historical archive (ERA5) for training, so the model is trained on the
 * same source it will see in production. Also turns a run of days into inputs 5–8 (air temperature,
 * humidity, wind, rain).
 */
import { addDays } from "../data/time";

export const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "relative_humidity_2m_max",
  "relative_humidity_2m_min",
  "wind_speed_10m_mean",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
  "precipitation_sum",
  "et0_fao_evapotranspiration",
  "shortwave_radiation_sum",
] as const;

export interface WeatherDaily {
  date: string;
  tmax: number;
  tmin: number;
  rh_max: number;
  rh_min: number;
  wind_mean: number;
  wind_max: number;
  wind_dir: number;
  rain: number;
  et0: number;
  rs: number;
}

export interface WeatherSeries {
  lat: number;
  lng: number;
  elevation_m: number | null;
  source: string;
  days: WeatherDaily[];
}

type Daily = Record<(typeof DAILY_VARS)[number], Array<number | null>> & { time: string[] };

/** Parse an Open-Meteo daily response (archive or forecast); days with a missing value are dropped. */
export function parseOpenMeteo(json: { latitude: number; longitude: number; elevation?: number; daily?: Daily }, source: string): WeatherSeries {
  const d = json.daily;
  const days: WeatherDaily[] = [];
  if (d) {
    d.time.forEach((date, i) => {
      const v = (k: (typeof DAILY_VARS)[number]) => d[k]?.[i];
      const row = {
        date,
        tmax: v("temperature_2m_max"),
        tmin: v("temperature_2m_min"),
        rh_max: v("relative_humidity_2m_max"),
        rh_min: v("relative_humidity_2m_min"),
        wind_mean: v("wind_speed_10m_mean"),
        wind_max: v("wind_speed_10m_max"),
        wind_dir: v("wind_direction_10m_dominant"),
        rain: v("precipitation_sum"),
        et0: v("et0_fao_evapotranspiration"),
        rs: v("shortwave_radiation_sum"),
      };
      if (Object.values(row).every((x) => x != null)) days.push(row as WeatherDaily);
    });
  }
  return { lat: json.latitude, lng: json.longitude, elevation_m: json.elevation ?? null, source, days };
}

export function archiveUrl(lat: number, lng: number, start: string, end: string): string {
  return (
    `${ARCHIVE_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${start}&end_date=${end}` +
    `&daily=${DAILY_VARS.join(",")}&timezone=Asia%2FQatar&wind_speed_unit=ms`
  );
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** The window of days around `asOf`: 7 past days, today and the 7-day forecast. */
export function weatherWindow(series: WeatherSeries, asOf: string) {
  const byDate = new Map(series.days.map((d) => [d.date, d]));
  const at = (offset: number) => byDate.get(addDays(asOf, offset)) ?? null;
  const today = at(0);
  const past = [-7, -6, -5, -4, -3, -2, -1].map(at);
  const next = [1, 2, 3, 4, 5, 6, 7].map(at);
  const past30 = Array.from({ length: 30 }, (_, i) => at(-30 + i));
  if (!today || past.some((d) => !d) || next.some((d) => !d) || past30.some((d) => !d)) return null;
  return { today, past: past as WeatherDaily[], next: next as WeatherDaily[], past30: past30 as WeatherDaily[] };
}

export type WeatherWindow = NonNullable<ReturnType<typeof weatherWindow>>;

/** Inputs 5–8, in the shape the model sees. Forecast arrays run from tomorrow for 7 days. */
export function weatherInputs(w: WeatherWindow) {
  const { today, past, next, past30 } = w;
  return {
    air_temperature: {
      unit: "°C",
      today_max: r1(today.tmax),
      today_min: r1(today.tmin),
      past_7d_mean_max: r1(mean(past.map((d) => d.tmax))),
      next_7d_max: next.map((d) => r1(d.tmax)),
      next_7d_min: next.map((d) => r1(d.tmin)),
    },
    relative_humidity: {
      unit: "%",
      today_max: r0(today.rh_max),
      today_min: r0(today.rh_min),
      next_7d_max: next.map((d) => r0(d.rh_max)),
      next_7d_min: next.map((d) => r0(d.rh_min)),
    },
    wind: {
      unit: "m/s at 10 m",
      today_mean: r1(today.wind_mean),
      today_max: r1(today.wind_max),
      today_direction: compass(today.wind_dir),
      next_7d_mean: next.map((d) => r1(d.wind_mean)),
      next_7d_max: next.map((d) => r1(d.wind_max)),
    },
    rain: {
      unit: "mm",
      today: r1(today.rain),
      past_7d: r1(past.reduce((a, d) => a + d.rain, 0)),
      past_30d: r1(past30.reduce((a, d) => a + d.rain, 0)),
      next_7d: next.map((d) => r1(d.rain)),
    },
  };
}

export type WeatherInputs = ReturnType<typeof weatherInputs>;
