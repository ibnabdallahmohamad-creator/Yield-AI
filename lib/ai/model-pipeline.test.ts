import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceReadingSchema } from "../account/ingest";
import { addDays, qatarDateString } from "../data/time";
import { DAILY_VARS } from "../dataset/weather";
import { formatUserMessage, INPUT_KEYS, ModelOutputSchema } from "../dataset/schema";
import type { Farm } from "../types";
import { ecToDsPerM, fahrenheitToCelsius, moistureSurvey, normalizeDeviceUnits, type ProbeMoisture } from "./esp32-units";
import { modelFormat, modelRequest, replyText } from "./model-client";
import { buildLiveFarmExample, focusOf } from "./model-input";

vi.mock("server-only", () => ({}));

const HOUR = 3_600_000;

describe("ESP32 units → stored / model units", () => {
  it("converts suffixed fields and explicit units", () => {
    expect(normalizeDeviceUnits({ vwc: 0.214 })).toMatchObject({ moisture: 21.4 });
    expect(normalizeDeviceUnits({ soil_temp_f: 82.4 })).toMatchObject({ temperature: 28 });
    expect(normalizeDeviceUnits({ air_temp_f: 97.16 })).toMatchObject({ air_temp: 36.2 });
    expect(normalizeDeviceUnits({ ec_ms_m: 185 })).toMatchObject({ ec: 1.85 });
    expect(normalizeDeviceUnits({ humidity_frac: 0.31 })).toMatchObject({ air_humidity: 31 });
    expect(normalizeDeviceUnits({ moisture: 0.25, temperature: 77, ec: 1850, units: { moisture: "fraction", temperature: "°F", ec: "µS/cm" } })).toEqual({
      moisture: 25,
      temperature: 25,
      ec: 1.85,
    });
  });

  it("keeps the canonical field when both are sent, and passes non-objects through", () => {
    expect(normalizeDeviceUnits({ moisture: 20, vwc: 0.5 })).toMatchObject({ moisture: 20 });
    expect(normalizeDeviceUnits([1, 2])).toEqual([1, 2]);
    expect(normalizeDeviceUnits(null)).toBe(null);
  });

  it("feeds the device schema: a sketch in °F and fractions validates in stored units", () => {
    const parsed = DeviceReadingSchema.parse({ vwc: 0.19, soil_temp_f: 86, ec_us_cm: 2100, air_temp_f: 104, humidity: 28 });
    expect(parsed).toMatchObject({ moisture: 19, temperature: 30, ec_us_cm: 2100, air_temp: 40, air_humidity: 28 });
  });

  it("converts single values", () => {
    expect(fahrenheitToCelsius(212)).toBe(100);
    expect(ecToDsPerM(1500, "µS/cm")).toBe(1.5);
    expect(ecToDsPerM(2, "mS/cm")).toBe(2);
    expect(ecToDsPerM(0.3, "S/m")).toBe(3);
    expect(ecToDsPerM(1, "furlongs")).toBe(null);
  });
});

describe("soil-moisture survey (model input 9)", () => {
  const now = Date.parse("2026-09-25T09:00:00Z");
  const at = (h: number) => new Date(now - h * HOUR).toISOString();

  it("averages each probe's last hour and compares with a week ago", () => {
    const readings: ProbeMoisture[] = [
      { sensor_id: "A", timestamp: at(0.2), moisture: 20 },
      { sensor_id: "A", timestamp: at(0.6), moisture: 22 },
      { sensor_id: "A", timestamp: at(3), moisture: 40 }, // older than the last hour: not in the survey
      { sensor_id: "B", timestamp: at(0.1), moisture: 14 },
      { sensor_id: "A", timestamp: at(168), moisture: 25 },
      { sensor_id: "B", timestamp: at(170), moisture: 17 },
    ];
    const { survey, weekAgoKnown } = moistureSurvey(readings, now);
    expect(weekAgoKnown).toBe(true);
    expect(survey).toMatchObject({ mean_vwc_pct: 17.5, min_vwc_pct: 14, max_vwc_pct: 21, readings: 3, change_7d_pct_points: -3.5 });
  });

  it("has no survey without a reading in the last 24 hours, and drops impossible values", () => {
    expect(moistureSurvey([{ sensor_id: "A", timestamp: at(30), moisture: 20 }], now).survey).toBe(null);
    expect(moistureSurvey([{ sensor_id: "A", timestamp: at(1), moisture: 250 }], now).survey).toBe(null);
  });
});

describe("model client", () => {
  it("guesses the server style from the URL", () => {
    expect(modelFormat("https://x.example/v1/chat/completions", undefined)).toBe("openai");
    expect(modelFormat("https://x.example/v1", undefined)).toBe("openai");
    expect(modelFormat("http://localhost:11434/api/chat", undefined)).toBe("ollama");
    expect(modelFormat("https://x.example/predict", undefined)).toBe("raw");
    expect(modelFormat("https://x.example/predict", "openai")).toBe("openai");
  });

  it("reads the answer out of every response shape", () => {
    const answer = { summary: "ok", crop_plan: {} };
    expect(replyText({ choices: [{ message: { content: "{\"a\":1}" } }] })).toBe("{\"a\":1}");
    expect(replyText({ message: { content: "x" } })).toBe("x");
    expect(replyText({ output: answer })).toBe(JSON.stringify(answer));
    expect(replyText(answer)).toBe(JSON.stringify(answer));
    expect(replyText([{ generated_text: "y" }])).toBe("y");
    expect(replyText({})).toBe(null);
  });
});

/** A month of Qatar-like daily weather in Open-Meteo's response shape, around today. */
function openMeteoResponse(today: string) {
  const time = Array.from({ length: 39 }, (_, i) => addDays(today, i - 31));
  const series = (f: (i: number) => number) => time.map((_, i) => Math.round(f(i) * 10) / 10);
  const daily: Record<string, unknown> = { time };
  const values: Record<(typeof DAILY_VARS)[number], (i: number) => number> = {
    temperature_2m_max: (i) => 40 + (i % 4),
    temperature_2m_min: (i) => 28 + (i % 3),
    relative_humidity_2m_max: (i) => 60 + (i % 5),
    relative_humidity_2m_min: (i) => 15 + (i % 4),
    wind_speed_10m_mean: (i) => 3 + (i % 6) * 0.5,
    wind_speed_10m_max: (i) => 6 + (i % 6) * 0.5,
    wind_direction_10m_dominant: () => 315,
    precipitation_sum: () => 0,
    et0_fao_evapotranspiration: (i) => 7 + (i % 3) * 0.4,
    shortwave_radiation_sum: () => 24,
  };
  for (const [k, f] of Object.entries(values)) daily[k] = series(f);
  return { latitude: 25.7, longitude: 51.4, elevation: 20, daily };
}

const farm: Farm = {
  id: "tester-khor",
  name: "Test farm",
  owner: "Tester",
  lat: 25.71,
  lng: 51.42,
  area_ha: 2,
  main_crop: "tomato",
  polygon: { type: "Polygon", coordinates: [[[51.41, 25.7], [51.43, 25.7], [51.43, 25.72], [51.41, 25.72], [51.41, 25.7]]] },
  region: "Al Khor",
  planting_date: "2026-08-20",
  soil_type: "sand",
  theta_fc: null,
  theta_wp: null,
  elevation_m: 20,
  ec_calibration_factor: 3,
  irrigation_water_ec: 2.4,
};

describe("live model input (Q2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the training-format input from ESP32 moisture and live weather, with an engine answer in the output format", async () => {
    const now = Date.now();
    const today = qatarDateString(now);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(openMeteoResponse(today)), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const moisture: ProbeMoisture[] = [
      { sensor_id: "P1", timestamp: new Date(now - 10 * 60_000).toISOString(), moisture: 9.8 },
      { sensor_id: "P2", timestamp: new Date(now - 5 * 60_000).toISOString(), moisture: 11.2 },
    ];
    const { input, engine } = await buildLiveFarmExample({ farm, moisture, question: "How much should I irrigate this week?", now });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0 as never])).toContain("wind_speed_unit=ms");
    expect(input.task).toBe("farm_analysis");
    expect(Object.keys(input.inputs)).toEqual([...INPUT_KEYS]);
    expect(input.inputs.soil_moisture).toMatchObject({ mean_vwc_pct: 10.5, min_vwc_pct: 9.8, max_vwc_pct: 11.2, depth_cm: "0–30" });
    expect(input.inputs.wind).toMatchObject({ unit: "m/s at 10 m", today_direction: "NW" });
    expect(input.inputs.air_temperature).toMatchObject({ unit: "°C" });
    expect(input.forecast_days).toHaveLength(7);
    expect(formatUserMessage(input).startsWith("Q2: How much should I irrigate this week?\n\n{")).toBe(true);
    expect(ModelOutputSchema.safeParse(engine).success).toBe(true);
    expect(modelRequest(input, "openai")).toMatchObject({ messages: [{ role: "system" }, { role: "user" }] });
  });

  it("maps questions to the training focus", () => {
    expect(focusOf("How much water does it need?")).toBe("irrigation");
    expect(focusOf("Is the heat a risk?")).toBe("risks");
    expect(focusOf("What will I earn?")).toBe("overall");
    expect(focusOf("What price will I get?")).toBe("economics");
    expect(focusOf("What should I plant next season?")).toBe("next crop");
  });
});
