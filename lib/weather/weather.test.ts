import { describe, expect, it } from "vitest";
import {
  compass,
  meanWindDirection,
  sampleGrid,
  summarizeOutlook,
  upcomingIndices,
  weatherAdvice,
  weatherCodeInfo,
} from "./analysis";
import { forecastUrl, gridLayout, HOURLY_VARIABLES, parseForecastResponse, parseHourly } from "./open-meteo";
import type { GridForecast, HourlySeries } from "./types";

const NOW = Date.parse("2026-09-25T09:20:00Z");
const DAY0 = Date.parse("2026-09-25T00:00:00Z");

/** An Open-Meteo location object for 48 hours from today 00:00 UTC (timeformat=unixtime). */
function location(lat: number, lng: number, fn: (hour: number, variable: string) => number | null) {
  const time = Array.from({ length: 48 }, (_, h) => (DAY0 + h * 3_600_000) / 1000);
  const hourly: Record<string, unknown> = { time };
  for (const variable of Object.values(HOURLY_VARIABLES)) hourly[variable] = time.map((_, h) => fn(h, variable));
  return { latitude: lat, longitude: lng, elevation: 12, hourly };
}

function series(values: Partial<Record<keyof HourlySeries, Array<number | null>>>, hours = 12): HourlySeries {
  const time = Array.from({ length: hours }, (_, h) => DAY0 + (h + 9) * 3_600_000);
  const empty = () => time.map((): number | null => null);
  return {
    time,
    temperature: empty(),
    apparent: empty(),
    dewPoint: empty(),
    humidity: empty(),
    precipitation: empty(),
    precipProbability: empty(),
    windSpeed: empty(),
    windDirection: empty(),
    windGusts: empty(),
    cloudCover: empty(),
    radiation: empty(),
    et0: empty(),
    vpd: empty(),
    weatherCode: empty(),
    uvIndex: empty(),
    ...values,
  } as HourlySeries;
}

describe("Open-Meteo request and parsing", () => {
  it("asks for every hourly variable in m/s, mm and Unix time for all locations", () => {
    const url = new URL(forecastUrl("https://api.open-meteo.com/", [
      { lat: 25.61, lng: 51.42 },
      { lat: 25.7, lng: 51.5 },
    ]));
    expect(url.pathname).toBe("/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("25.6100,25.7000");
    expect(url.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(url.searchParams.get("hourly")).toContain("precipitation_probability");
    expect(url.searchParams.get("hourly")).toContain("wind_gusts_10m");
  });

  it("keeps 24 hours from the current hour", () => {
    const hourly = parseHourly(location(25.6, 51.4, (h, v) => (v === "temperature_2m" ? 20 + h : 1)), NOW)!;
    expect(hourly.time).toHaveLength(24);
    expect(hourly.time[0]).toBe(Date.parse("2026-09-25T09:00:00Z"));
    expect(hourly.temperature[0]).toBe(29);
    expect(hourly.windSpeed[0]).toBe(1);
  });

  it("reads ISO times too, and nulls for missing variables", () => {
    const loc = { hourly: { time: ["2026-09-25T09:00", "2026-09-25T10:00"], temperature_2m: [30, null] } };
    const hourly = parseHourly(loc, NOW)!;
    expect(hourly.time).toEqual([Date.parse("2026-09-25T09:00:00Z"), Date.parse("2026-09-25T10:00:00Z")]);
    expect(hourly.temperature).toEqual([30, null]);
    expect(hourly.humidity).toEqual([null, null]);
  });

  it("splits a multi-location response into farms and the grid", () => {
    const farms = [
      { id: "a", name: "A", lat: 25.6, lng: 51.4 },
      { id: "b", name: "B", lat: 25.8, lng: 51.3 },
    ];
    const layout = gridLayout({ minLat: 25.6, maxLat: 25.8, minLng: 51.3, maxLng: 51.4 });
    const cells = layout.lats.length * layout.lngs.length;
    const json = [
      location(25.6, 51.4, () => 1),
      location(25.8, 51.3, () => 2),
      ...Array.from({ length: cells }, (_, i) => location(0, 0, (h, v) => (v === "temperature_2m" ? i : 0))),
    ];
    const { points, grid } = parseForecastResponse(json, farms, layout, NOW);
    expect(points.map((p) => [p.id, p.hourly.temperature[0], p.elevation])).toEqual([
      ["a", 1, 12],
      ["b", 2, 12],
    ]);
    expect(grid!.fields.temperature[0]).toHaveLength(cells);
    expect(grid!.fields.temperature[0][cells - 1]).toBe(cells - 1);
    expect(grid!.time).toHaveLength(24);
  });

  it("lays a grid of 5–10 points per side around the farms, north to south", () => {
    const layout = gridLayout({ minLat: 25.5, maxLat: 25.9, minLng: 51.1, maxLng: 51.5 });
    expect(layout.lats.length).toBeGreaterThanOrEqual(5);
    expect(layout.lngs.length).toBeLessThanOrEqual(10);
    expect(layout.lats[0]).toBeGreaterThan(25.9);
    expect(layout.lats.at(-1)!).toBeLessThan(25.5);
    expect(layout.lngs[0]).toBeLessThan(51.1);
    // One farm still gets a regional map.
    const single = gridLayout({ minLat: 25.6, maxLat: 25.6, minLng: 51.4, maxLng: 51.4 });
    expect(single.lats[0] - single.lats.at(-1)!).toBeGreaterThanOrEqual(0.39);
  });
});

describe("outlook and advice", () => {
  it("summarises the next hours", () => {
    const s = summarizeOutlook(
      series({
        temperature: [30, 34, 38, 41, 40, 37, 33, 31, 30, 29, 28, 27],
        precipitation: [0, 0, 0, 0, 0.5, 2, 1, 0, 0, 0, 0, 0],
        windSpeed: [2, 2, 3, 5, 6, 8, 5, 4, 3, 2, 2, 2],
        windGusts: [3, 3, 5, 9, 11, 14, 9, 7, 5, 3, 3, 3],
        windDirection: [0, 10, 350, 0, 5, 355, 0, 0, 10, 350, 0, 0],
        et0: [0.2, 0.4, 0.6, 0.7, 0.7, 0.6, 0.4, 0.2, 0.1, 0, 0, 0],
      }),
    );
    expect(s.tempMax?.value).toBe(41);
    expect(s.rainTotal).toBeCloseTo(3.5);
    expect(s.rainHours).toBe(3);
    expect(s.gustMax?.value).toBe(14);
    expect(compass(s.windDirection)).toBe("N");
    expect(s.et0Total).toBeCloseTo(3.9);
  });

  it("advises on rain, heat, wind and crop water use", () => {
    const advice = weatherAdvice(
      series({
        temperature: [36, 38, 40, 43, 42, 39, 35, 33, 31, 30, 29, 28],
        precipitation: [0, 0, 0, 0, 0, 0, 0, 3, 2, 0, 0, 0],
        precipProbability: [0, 0, 0, 10, 20, 40, 70, 80, 60, 20, 0, 0],
        windSpeed: [1, 1, 2, 6, 8, 7, 5, 4, 2, 1, 1, 1],
        windGusts: [2, 2, 3, 9, 12, 11, 8, 6, 4, 2, 2, 2],
        humidity: [40, 30, 20, 15, 15, 20, 30, 50, 70, 80, 88, 90],
        et0: [0.3, 0.5, 0.7, 0.8, 0.8, 0.6, 0.4, 0.2, 0.1, 0, 0, 0],
      }),
      { name: "Tomato", kc: 1.15 },
    );
    const byTopic = Object.fromEntries(advice.map((a) => [a.topic + ":" + a.level, a.title]));
    expect(byTopic["heat:alert"]).toMatch(/Extreme heat: 43\.0 °C at 15:00/);
    expect(byTopic["rain:info"]).toBe("5.0 mm of rain expected");
    expect(byTopic["wind:warn"]).toMatch(/Gusts up to 12\.0 m\/s/);
    // The two calm hours at the end (21:00–23:00 Qatar time) make a spray window.
    expect(Object.keys(byTopic)).toContain("wind:good");
    const water = advice.find((a) => a.topic === "water")!;
    expect(water.title).toBe("Reference ET₀ 4.4 mm over the next 12 h");
    expect(water.detail).toContain("5.1 mm");
    expect(advice[0].level).toBe("alert");
  });

  it("finds the upcoming hours from now", () => {
    const s = series({}, 24);
    expect(upcomingIndices(s, DAY0 + 10 * 3_600_000 + 60_000)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("names weather codes and averages wind directions as vectors", () => {
    expect(weatherCodeInfo(63)).toEqual({ label: "Rain", icon: "rain" });
    expect(weatherCodeInfo(null).label).toBe("—");
    expect(meanWindDirection([5, 5], [350, 10])).toBeCloseTo(0, 5);
    expect(compass(225)).toBe("SW");
  });
});

describe("grid sampling", () => {
  const grid: GridForecast = {
    lats: [26, 25],
    lngs: [51, 52],
    time: [DAY0],
    fields: {
      temperature: [[10, 20, 30, 40]],
      humidity: [[0, 0, 0, 0]],
      precipitation: [[0, 0, 0, 0]],
      precipProbability: [[0, 0, 0, 0]],
      windSpeed: [[1, 1, 1, 1]],
      windDirection: [[350, 10, 350, 10]],
      windGusts: [[1, 1, 1, 1]],
    },
  };
  it("interpolates bilinearly and returns null outside the grid", () => {
    expect(sampleGrid(grid, "temperature", 0, 26, 51)).toBe(10);
    expect(sampleGrid(grid, "temperature", 0, 25, 52)).toBe(40);
    expect(sampleGrid(grid, "temperature", 0, 25.5, 51.5)).toBe(25);
    expect(sampleGrid(grid, "temperature", 0, 24, 51.5)).toBeNull();
    expect(sampleGrid(grid, "windDirection", 0, 25.5, 51.5)).toBeCloseTo(0, 5);
  });
});
