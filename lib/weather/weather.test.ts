import { describe, expect, it } from "vitest";
import { contourLevels, marchingSquares } from "./contours";
import { apparentTemperature, decodeGrid, dewPoint, FieldSampler, frameAt, levelArray, pointSeries, wetBulb, windFromDeg } from "./field";
import { beaufort, formatWeather, WEATHER_LAYERS } from "./layers";
import { legendPos, lutFor, lutIndex, paletteColor, PALETTES, textOn } from "./palettes";
import { invMercY, mercatorHeight, mercY, renderLevel } from "./render";
import { FIELD_SCALE, GRID_FIELDS, GRID_LEVELS, levelEast, levelNorth, levelPoints, type GridFieldKey, type GridLevelSpec, type WeatherGridPayload } from "./spec";
import { isNight, nightSpans, sunTimes } from "./sun";
import { goodWindows, sprayRating } from "./work-windows";
import type { PointHour } from "./field";

// ---------------------------------------------------------------------------
// A synthetic grid: every field is a known function of place and hour
// ---------------------------------------------------------------------------

type Fn = (lat: number, lng: number, t: number) => number;

const FNS: Record<GridFieldKey, Fn> = {
  temp: (lat, lng, t) => 30 + (lng - 50) * 2 - (lat - 25) + t,
  rh: (lat) => 40 + (lat - 25) * 10,
  precip: (_lat, _lng, t) => (t === 1 ? 2 : 0),
  precipProb: () => 10,
  u: () => 3,
  v: () => -4,
  gust: () => 8,
  cloud: () => 20,
  pressure: (lat) => 1008 + (lat - 25),
};

function level(spec: GridLevelSpec, nt: number, shift = 0) {
  const fields = {} as Record<GridFieldKey, number[]>;
  for (const key of GRID_FIELDS) {
    const arr: number[] = [];
    for (let t = 0; t < nt; t++)
      for (let j = 0; j < spec.ny; j++)
        for (let i = 0; i < spec.nx; i++) arr.push(Math.round((FNS[key](spec.south + j * spec.step, spec.west + i * spec.step, t) + (key === "temp" ? shift : 0)) * FIELD_SCALE[key]));
    fields[key] = arr;
  }
  return { ...spec, fields };
}

function payload(nt = 3, fineShift = 0): WeatherGridPayload {
  const t0 = Date.UTC(2026, 8, 25, 9) / 1000;
  return {
    source: "open-meteo",
    times: Array.from({ length: nt }, (_, k) => t0 + k * 3600),
    fetched_at: "2026-09-25T09:00:00.000Z",
    next_refresh_at: "2026-09-25T09:00:00.000Z",
    stale: false,
    levels: { coarse: level(GRID_LEVELS.coarse, nt), fine: level(GRID_LEVELS.fine, nt, fineShift) },
  };
}

describe("grid spec", () => {
  it("nests the Qatar grid inside the Gulf grid, on the coarse grid's lines", () => {
    const c = GRID_LEVELS.coarse;
    const f = GRID_LEVELS.fine;
    expect(f.south).toBeGreaterThan(c.south);
    expect(f.west).toBeGreaterThan(c.west);
    expect(levelNorth(f)).toBeLessThan(levelNorth(c));
    expect(levelEast(f)).toBeLessThan(levelEast(c));
    // Under Open-Meteo's 600 locations a minute.
    expect(levelPoints(c).length + levelPoints(f).length).toBeLessThanOrEqual(600);
  });
});

describe("field sampling", () => {
  const field = decodeGrid(payload());

  it("decodes the integer payload back to units", () => {
    expect(field.nt).toBe(3);
    expect(field.times[1] - field.times[0]).toBe(3_600_000);
    const s = new FieldSampler(field, 0);
    expect(s.value("pressure", 25, 51)).toBeCloseTo(1008, 1);
  });

  it("reproduces a linear field exactly between the nodes (bicubic and bilinear)", () => {
    const s = new FieldSampler(field, 0);
    for (const [lat, lng] of [
      [25.13, 51.27],
      [24.9, 50.95],
      [23.3, 49.1],
      [26.4, 53.3],
    ]) {
      expect(s.value("temp", lat, lng)).toBeCloseTo(FNS.temp(lat, lng, 0), 1);
      expect(s.value("temp", lat, lng, true)).toBeCloseTo(FNS.temp(lat, lng, 0), 1);
    }
  });

  it("interpolates linearly in time", () => {
    expect(new FieldSampler(field, 0.5).value("temp", 25.2, 51.4)).toBeCloseTo(FNS.temp(25.2, 51.4, 0.5), 1);
  });

  it("is NaN outside the Gulf grid", () => {
    expect(new FieldSampler(field, 0).value("temp", 40, 51)).toBeNaN();
  });

  it("uses the fine grid inside Qatar and blends into the coarse one at its edge", () => {
    const f = decodeGrid(payload(2, 1)); // the fine grid is 1 °C warmer
    const s = new FieldSampler(f, 0);
    const inner = s.value("temp", 25.3, 51.2);
    expect(inner - FNS.temp(25.3, 51.2, 0)).toBeCloseTo(1, 1);
    const outside = s.value("temp", 23.0, 48.5);
    expect(outside - FNS.temp(23.0, 48.5, 0)).toBeCloseTo(0, 1);
    const edge = s.value("temp", 25.3, GRID_LEVELS.fine.west + 0.1); // halfway into the blend band
    expect(edge - FNS.temp(25.3, GRID_LEVELS.fine.west + 0.1, 0)).toBeGreaterThan(0.05);
    expect(edge - FNS.temp(25.3, GRID_LEVELS.fine.west + 0.1, 0)).toBeLessThan(0.95);
  });

  it("derives wind speed, accumulated rain and dew point per node", () => {
    const l = field.fine;
    expect(levelArray(l, "speed")[0]).toBeCloseTo(5, 3);
    const sum = levelArray(l, "precipSum");
    expect(sum[0]).toBe(0);
    expect(sum[l.n]).toBeCloseTo(2, 5);
    expect(sum[2 * l.n]).toBeCloseTo(2, 5);
    expect(frameAt(l, "dew", 0)[0]).toBeCloseTo(dewPoint(l.data.temp![0], l.data.rh![0]), 4);
  });

  it("reads a point's hours with the meteorological wind direction", () => {
    const hours = pointSeries(field, 25.3, 51.4);
    expect(hours).toHaveLength(3);
    expect(hours[0].wind).toBeCloseTo(5, 2);
    // u = 3 (towards east), v = −4 (towards south): the wind comes from the north-west.
    expect(hours[0].windDir).toBeCloseTo(windFromDeg(3, -4), 5);
    expect(hours[0].windDir).toBeGreaterThan(270);
    expect(hours[0].windDir).toBeLessThan(360);
    expect(hours[1].precip).toBeCloseTo(2, 2);
  });
});

describe("weather formulas", () => {
  it("dew point (Magnus)", () => {
    expect(dewPoint(30, 50)).toBeCloseTo(18.4, 0);
    expect(dewPoint(20, 100)).toBeCloseTo(20, 1);
  });

  it("wet bulb (Stull): 20 °C at 50 % is about 13.7 °C", () => {
    expect(wetBulb(20, 50)).toBeCloseTo(13.7, 1);
  });

  it("feels-like rises with humidity and falls with wind", () => {
    expect(apparentTemperature(35, 70, 1)).toBeGreaterThan(apparentTemperature(35, 20, 1));
    expect(apparentTemperature(35, 50, 6)).toBeLessThan(apparentTemperature(35, 50, 1));
  });

  it("wind direction is where the wind comes from", () => {
    expect(windFromDeg(0, -5)).toBeCloseTo(0, 5); // blowing south: from the north
    expect(windFromDeg(-5, 0)).toBeCloseTo(90, 5); // blowing west: from the east
    expect(windFromDeg(0, 5)).toBeCloseTo(180, 5);
    expect(windFromDeg(5, 0)).toBeCloseTo(270, 5);
  });

  it("Beaufort", () => {
    expect(beaufort(0.2).force).toBe(0);
    expect(beaufort(4).label).toBe("Gentle breeze");
    expect(beaufort(40).force).toBe(12);
  });

  it("formats values with their unit", () => {
    expect(formatWeather(WEATHER_LAYERS.temp, 31.26)).toBe("31.3°C");
    expect(formatWeather(WEATHER_LAYERS.wind, 4)).toBe("4.0 m/s");
    expect(formatWeather(WEATHER_LAYERS.rain, 0.04)).toBe("0.04 mm/h");
    expect(formatWeather(WEATHER_LAYERS.rh, NaN)).toBe("—");
  });
});

describe("palettes", () => {
  it("hits each stop's colour exactly", () => {
    for (const [v, c] of PALETTES.wind.stops) {
      const got = paletteColor(PALETTES.wind, v);
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - c[k])).toBeLessThanOrEqual(1);
    }
  });

  it("keeps Qatar's summer range distinguishable (30, 35, 40, 45 °C all differ)", () => {
    const cols = [30, 35, 40, 45].map((v) => paletteColor(PALETTES.temp, v));
    for (let i = 1; i < cols.length; i++) {
      const d = Math.hypot(cols[i][0] - cols[i - 1][0], cols[i][1] - cols[i - 1][1], cols[i][2] - cols[i - 1][2]);
      expect(d).toBeGreaterThan(35);
    }
  });

  it("is transparent where it's dry", () => {
    expect(paletteColor(PALETTES.rain, 0)[3]).toBe(0);
    expect(paletteColor(PALETTES.rain, 2)[3]).toBeGreaterThan(150);
  });

  it("the lookup table matches the palette and clamps", () => {
    const lut = lutFor(PALETTES.temp);
    const i = lutIndex(lut, 33);
    const c = paletteColor(PALETTES.temp, 33);
    for (let k = 0; k < 3; k++) expect(Math.abs(lut.rgba[i * 4 + k] - c[k])).toBeLessThanOrEqual(2);
    expect(lutIndex(lut, -999)).toBe(0);
    expect(lutIndex(lut, 999)).toBe(lut.size - 1);
    const rain = lutFor(PALETTES.rain);
    expect(lutIndex(rain, 1)).toBeGreaterThan(lutIndex(rain, 0.25));
  });

  it("legend positions and text contrast", () => {
    expect(legendPos(PALETTES.temp, 25, 0, 50)).toBeCloseTo(0.5, 5);
    expect(legendPos(PALETTES.temp, 99, 0, 50)).toBe(1);
    expect(textOn([255, 240, 120, 255])).toBe("#101412");
    expect(textOn([60, 20, 80, 255])).toBe("#ffffff");
  });
});

describe("rendering", () => {
  it("Web Mercator helpers are inverse and heights keep the aspect", () => {
    expect(invMercY(mercY(25.3))).toBeCloseTo(25.3, 8);
    const h = mercatorHeight({ west: 50, east: 52, south: 24, north: 26 }, 400);
    expect(h).toBeGreaterThan(400);
    expect(h).toBeLessThan(460);
  });

  it("paints every pixel inside the value range of its cell", () => {
    const field = decodeGrid(payload());
    const l = field.fine;
    const slice = frameAt(l, "temp", 0);
    const lut = lutFor(PALETTES.temp);
    const px = renderLevel(l, slice, "temp", lut, 60, mercatorHeight(l, 60));
    expect(px.length).toBe(60 * mercatorHeight(l, 60) * 4);
    // Alpha is opaque without feathering, and the colours come from the LUT.
    expect(px[3]).toBe(255);
    const colour = [px[0], px[1], px[2]].join(",");
    let found = false;
    for (let i = 0; i < lut.size && !found; i++) found = [lut.rgba[i * 4], lut.rgba[i * 4 + 1], lut.rgba[i * 4 + 2]].join(",") === colour;
    expect(found).toBe(true);
  });
});

describe("contours", () => {
  it("levels are multiples of the step inside the range", () => {
    expect(contourLevels(27.3, 31.9, 1)).toEqual([28, 29, 30, 31]);
    expect(contourLevels(0, 1, 0)).toEqual([]);
  });

  it("a ramp gives a straight line at the right place", () => {
    const w = 5;
    const h = 4;
    const v = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[y * w + x] = x; // value = x
    const [set] = marchingSquares(v, w, h, [2.5]);
    expect(set.segments.length).toBe((h - 1) * 4);
    for (let k = 0; k < set.segments.length; k += 2) expect(set.segments[k]).toBeCloseTo(2.5, 6);
  });
});

describe("sun", () => {
  const doha = { lat: 25.29, lng: 51.53 };
  it("Doha, 25 Sep 2026: sunrise about 05:27, sunset about 17:31 Qatar time", () => {
    const s = sunTimes(Date.UTC(2026, 8, 25, 9), doha.lat, doha.lng)!;
    const q = (ms: number) => {
      const d = new Date(ms + 3 * 3_600_000);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    };
    expect(Math.abs(q(s.rise) - (5 * 60 + 27))).toBeLessThanOrEqual(8);
    expect(Math.abs(q(s.set) - (17 * 60 + 31))).toBeLessThanOrEqual(8);
  });

  it("nights between two noons, and isNight", () => {
    const noon = Date.UTC(2026, 8, 25, 9);
    const spans = nightSpans(noon, noon + 24 * 3_600_000, doha.lat, doha.lng);
    expect(spans).toHaveLength(1);
    const hours = (spans[0][1] - spans[0][0]) / 3_600_000;
    expect(hours).toBeGreaterThan(11.5);
    expect(hours).toBeLessThan(12.5);
    expect(isNight(Date.UTC(2026, 8, 25, 21), doha.lat, doha.lng)).toBe(true); // 00:00 Qatar
    expect(isNight(Date.UTC(2026, 8, 25, 9), doha.lat, doha.lng)).toBe(false); // 12:00 Qatar
  });
});

describe("spraying", () => {
  const ok = { wind: 2.5, gust: 4, precip: 0, precipProb: 0, temp: 24, deltaT: 5 };
  it("rates hours", () => {
    expect(sprayRating(ok).tone).toBe("good");
    expect(sprayRating({ ...ok, wind: 6.5 }).tone).toBe("poor");
    expect(sprayRating({ ...ok, deltaT: 12 }).tone).toBe("poor");
    expect(sprayRating({ ...ok, precip: 0.4 }).tone).toBe("poor");
    expect(sprayRating({ ...ok, wind: 0.4 }).tone).toBe("fair");
    expect(sprayRating({ ...ok, deltaT: 9 }).tone).toBe("fair");
  });

  it("finds runs of good hours, longest first", () => {
    const base: PointHour = { time: 0, temp: 24, feels: 24, dew: 14, rh: 55, precip: 0, precipProb: 0, wind: 2.5, windDir: 0, gust: 4, cloud: 0, pressure: 1010 };
    const hot = { ...base, temp: 40, rh: 15 };
    const hours = [base, base, hot, base, base, base, hot].map((h, i) => ({ ...h, time: i * 3_600_000 }));
    expect(goodWindows(hours, 2)).toEqual([
      { from: 3, to: 5 },
      { from: 0, to: 1 },
    ]);
  });
});
