import { describe, expect, it } from "vitest";
import { addDays } from "../data/time";
import { interpolateForecast, mergeForecast, type AnchorWeather } from "./forecast";
import { parseOpenMeteoLocation } from "./open-meteo";
import { compassFromDegrees, type ForecastDay, type LocationWeather } from "./types";
import { parseWeatherApi, WeatherApiError } from "./weatherapi";

/** A trimmed WeatherAPI.com forecast.json response (field names as documented). */
function weatherApiFixture(days = 3) {
  const hours = (date: string) =>
    Array.from({ length: 24 }, (_, h) => ({
      time: `${date} ${String(h).padStart(2, "0")}:00`,
      temp_c: 30 + 8 * Math.sin(((h - 9) / 24) * 2 * Math.PI),
      humidity: 40 + h,
      wind_kph: 10 + (h % 6),
      wind_degree: 315,
      gust_kph: 20,
      precip_mm: 0,
      chance_of_rain: 0,
      uv: 6,
      short_rad: h >= 6 && h <= 17 ? 600 : 0,
    }));
  return {
    location: { name: "Al Khor", region: "Al Khor", country: "Qatar", lat: 25.68, lon: 51.5 },
    current: {
      last_updated_epoch: 1790000000,
      temp_c: 34.2,
      feelslike_c: 37.1,
      humidity: 48,
      wind_kph: 18.4,
      gust_kph: 25.2,
      wind_dir: "NW",
      wind_degree: 320,
      pressure_mb: 1004,
      precip_mm: 0,
      cloud: 0,
      uv: 8,
      is_day: 1,
      condition: { text: "Sunny", icon: "//cdn.weatherapi.com/weather/64x64/day/113.png", code: 1000 },
    },
    forecast: {
      forecastday: Array.from({ length: days }, (_, i) => {
        const date = `2026-09-${String(25 + i).padStart(2, "0")}`;
        return {
          date,
          day: {
            maxtemp_c: 38 + i,
            mintemp_c: 29,
            avgtemp_c: 33,
            maxwind_kph: 24,
            totalprecip_mm: 0,
            avghumidity: 52,
            daily_chance_of_rain: 0,
            uv: 9,
            condition: { text: "Sunny", icon: "//cdn.weatherapi.com/weather/64x64/day/113.png" },
          },
          hour: hours(date),
        };
      }),
    },
    alerts: { alert: [] },
  };
}

function day(date: string, source: ForecastDay["source"], tmax = 40): ForecastDay {
  return {
    date,
    tmaxC: tmax,
    tminC: 30,
    tavgC: 35,
    rhMax: 70,
    rhMin: 30,
    rhMean: 50,
    windMeanKph: 12,
    windMaxKph: 25,
    windDir: "NW",
    precipMm: 0,
    chanceOfRain: 0,
    uv: 9,
    condition: "Sunny",
    icon: null,
    et0Mm: 7,
    source,
  };
}

describe("WeatherAPI.com parsing", () => {
  it("reads current conditions and derives daily humidity, wind and ET₀ from the hours", () => {
    const r = parseWeatherApi(weatherApiFixture(), 25.68);
    expect(r.locationName).toBe("Al Khor, Al Khor");
    expect(r.current).toMatchObject({ tempC: 34.2, humidity: 48, windKph: 18.4, windDir: "NW", condition: "Sunny", source: "weatherapi" });
    expect(r.current?.icon).toBe("https://cdn.weatherapi.com/weather/64x64/day/113.png");
    expect(r.days).toHaveLength(3);
    const d = r.days[0];
    expect(d).toMatchObject({ date: "2026-09-25", tmaxC: 38, tminC: 29, rhMin: 40, rhMax: 63, windDir: "NW", source: "weatherapi" });
    expect(d.windMeanKph).toBe(12.5); // mean of 10 + (h mod 6) over 24 hours
    // Full day of short_rad → Penman–Monteith ET₀ in a plausible late-September range.
    expect(d.et0Mm).toBeGreaterThan(4);
    expect(d.et0Mm).toBeLessThan(10);
  });

  it("turns API errors into WeatherApiError", () => {
    expect(() => parseWeatherApi({ error: { code: 2006, message: "API key is invalid." } }, 25)).toThrow(WeatherApiError);
    try {
      parseWeatherApi({ error: { code: 2006, message: "API key is invalid." } }, 25);
    } catch (e) {
      expect((e as WeatherApiError).code).toBe(2006);
    }
  });
});

describe("Open-Meteo parsing", () => {
  it("reads daily arrays and WMO codes", () => {
    const r = parseOpenMeteoLocation({
      current: { time: "2026-09-25T10:00", temperature_2m: 33, relative_humidity_2m: 50, wind_speed_10m: 14, wind_direction_10m: 300, weather_code: 0, is_day: 1 },
      daily: {
        time: ["2026-09-25", "2026-09-26"],
        weather_code: [1, 61],
        temperature_2m_max: [39, 38],
        temperature_2m_min: [29, 28],
        relative_humidity_2m_max: [75, 80],
        relative_humidity_2m_min: [30, 35],
        wind_speed_10m_mean: [12, 18],
        wind_direction_10m_dominant: [315, 90],
        precipitation_sum: [0, 3.2],
        et0_fao_evapotranspiration: [6.1, 5.2],
      },
    });
    expect(r.current).toMatchObject({ tempC: 33, humidity: 50, windDir: "WNW", condition: "Clear sky", source: "open-meteo" });
    expect(r.days[1]).toMatchObject({ date: "2026-09-26", precipMm: 3.2, condition: "Light rain", windDir: "E", et0Mm: 5.2 });
  });
});

describe("forecast merging and interpolation", () => {
  it("fills the week after WeatherAPI.com's days with Open-Meteo", () => {
    const wa = ["2026-09-25", "2026-09-26", "2026-09-27"].map((d) => day(d, "weatherapi"));
    const om = Array.from({ length: 7 }, (_, i) => day(addDays("2026-09-25", i), "open-meteo"));
    const merged = mergeForecast("2026-09-25", wa, om);
    expect(merged).toHaveLength(7);
    expect(merged.slice(0, 3).every((d) => d.source === "weatherapi")).toBe(true);
    expect(merged.slice(3).every((d) => d.source === "open-meteo")).toBe(true);
    expect(merged.at(-1)?.date).toBe("2026-10-01");
  });

  it("derives a cell forecast by inverse-distance weighting of the anchors", () => {
    const weather = (tmax: number): LocationWeather => ({
      lat: 0,
      lng: 0,
      locationName: null,
      current: null,
      days: [day("2026-09-25", "weatherapi", tmax)],
      alerts: [],
      sources: ["WeatherAPI.com"],
      fetchedAt: "",
      note: null,
    });
    const anchors: AnchorWeather[] = [
      { name: "A", lat: 25.0, lng: 51.0, weather: weather(40) },
      { name: "B", lat: 26.0, lng: 51.0, weather: weather(44) },
    ];
    const [atA] = interpolateForecast(25.0, 51.0, anchors);
    const [mid] = interpolateForecast(25.5, 51.0, anchors);
    expect(atA.tmaxC).toBeCloseTo(40, 0);
    expect(mid.tmaxC).toBeCloseTo(42, 1);
    expect(mid.source).toBe("derived");
    expect(mid.windDir).toBe("NW");
  });

  it("names compass directions", () => {
    expect(compassFromDegrees(0)).toBe("N");
    expect(compassFromDegrees(315)).toBe("NW");
    expect(compassFromDegrees(-45)).toBe("NW");
    expect(compassFromDegrees(null)).toBeNull();
  });
});
