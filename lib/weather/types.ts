/**
 * Hourly weather forecast shapes shared by the server (fetch, cache) and the weather tabs.
 * Every array is aligned with `time` (hour starts, ms since the epoch).
 */

export interface HourlySeries {
  time: number[];
  /** Air temperature at 2 m, °C. */
  temperature: Array<number | null>;
  /** Feels-like temperature, °C. */
  apparent: Array<number | null>;
  dewPoint: Array<number | null>;
  /** Relative humidity at 2 m, %. */
  humidity: Array<number | null>;
  /** Rain + showers + snow in the preceding hour, mm. */
  precipitation: Array<number | null>;
  /** Chance of more than 0.1 mm in the hour, %. */
  precipProbability: Array<number | null>;
  /** Wind speed at 10 m, m/s. */
  windSpeed: Array<number | null>;
  /** Direction the wind comes from, degrees (0 = north). */
  windDirection: Array<number | null>;
  /** Gusts at 10 m, m/s. */
  windGusts: Array<number | null>;
  /** Total cloud cover, %. */
  cloudCover: Array<number | null>;
  /** Shortwave radiation, W/m². */
  radiation: Array<number | null>;
  /** FAO-56 reference evapotranspiration for the hour, mm. */
  et0: Array<number | null>;
  /** Vapour pressure deficit, kPa. */
  vpd: Array<number | null>;
  /** WMO weather code. */
  weatherCode: Array<number | null>;
  uvIndex: Array<number | null>;
}

export type HourlyField = Exclude<keyof HourlySeries, "time">;

export interface PointForecast {
  /** Farm id. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  hourly: HourlySeries;
}

/** Fields forecast on the regional grid (drawn as maps). */
export const GRID_FIELDS = ["temperature", "humidity", "precipitation", "precipProbability", "windSpeed", "windDirection", "windGusts"] as const;
export type GridField = (typeof GRID_FIELDS)[number];

/**
 * A regular grid of forecast points around the farms. Cell `r * cols + c` is at
 * (lats[r], lngs[c]); rows run north → south, columns west → east.
 */
export interface GridForecast {
  lats: number[];
  lngs: number[];
  time: number[];
  /** fields[field][hour][cell] */
  fields: Record<GridField, Array<Array<number | null>>>;
}

export interface ForecastBundle {
  fetchedAt: string;
  /** When the next 12-hourly refresh is due. */
  nextUpdate: string;
  source: "open-meteo";
  points: PointForecast[];
  grid: GridForecast | null;
  /** True when the forecast is older than 12 hours because Open-Meteo could not be reached. */
  stale: boolean;
}

/** GET /api/weather response. */
export interface WeatherResponse {
  forecast: ForecastBundle | null;
  error: string | null;
}
