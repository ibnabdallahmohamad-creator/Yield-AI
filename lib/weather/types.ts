/** Weather shapes shared by the server (WeatherAPI.com / Open-Meteo clients) and the UI. */

export type WeatherSource = "weatherapi" | "open-meteo" | "derived";

export interface CurrentWeather {
  /** ISO timestamp of the observation. */
  observedAt: string;
  tempC: number | null;
  feelsLikeC: number | null;
  humidity: number | null;
  windKph: number | null;
  gustKph: number | null;
  /** Compass direction the wind blows from, e.g. "NW". */
  windDir: string | null;
  windDegree: number | null;
  pressureMb: number | null;
  precipMm: number | null;
  cloud: number | null;
  uv: number | null;
  condition: string;
  /** Condition icon URL (WeatherAPI.com), when available. */
  icon: string | null;
  isDay: boolean | null;
  source: WeatherSource;
}

export interface ForecastDay {
  /** Local (Asia/Qatar) date, YYYY-MM-DD. */
  date: string;
  tmaxC: number | null;
  tminC: number | null;
  tavgC: number | null;
  rhMax: number | null;
  rhMin: number | null;
  rhMean: number | null;
  windMeanKph: number | null;
  windMaxKph: number | null;
  /** Dominant wind direction (from), compass. */
  windDir: string | null;
  precipMm: number | null;
  chanceOfRain: number | null;
  uv: number | null;
  condition: string;
  icon: string | null;
  /** Reference ET0 for the day, mm (FAO-56; Open-Meteo's own when that is the source). */
  et0Mm: number | null;
  source: WeatherSource;
}

export interface LocationWeather {
  lat: number;
  lng: number;
  /** Place name reported by the provider, when any. */
  locationName: string | null;
  current: CurrentWeather | null;
  /** Up to 7 days starting today. */
  days: ForecastDay[];
  alerts: string[];
  /** Providers that contributed, e.g. ["WeatherAPI.com", "Open-Meteo"]. */
  sources: string[];
  fetchedAt: string;
  /** Set when a provider failed or is not configured. */
  note: string | null;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compassFromDegrees(deg: number | null | undefined): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
