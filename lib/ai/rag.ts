/**
 * Retrieval-augmented grounding for the chat: adds to a farm's ChatContext
 *  - the 10 km² land-atlas cell under the farm (soil, fertility, climate, groundwater, crops),
 *  - real-time weather and the 7-day forecast (WeatherAPI.com, Open-Meteo fills gaps),
 *  - research passages that match the question, and summaries of any region it names.
 */
import "server-only";
import { knowledgeFor, landContextAt, regionNotesFor } from "../land/context";
import { withTimeout } from "../supabase/server";
import { getLocationWeather } from "../weather/forecast";
import type { LocationWeather } from "../weather/types";
import type { ChatContext, WeatherContext } from "./contract";

const WEATHER_BUDGET_MS = 7000;

export function toWeatherContext(w: LocationWeather): WeatherContext {
  const c = w.current;
  return {
    sources: w.sources,
    current: c
      ? {
          observed_at: c.observedAt,
          temp_c: c.tempC,
          feels_like_c: c.feelsLikeC,
          humidity_pct: c.humidity,
          wind_kph: c.windKph,
          gust_kph: c.gustKph,
          wind_dir: c.windDir,
          precip_mm: c.precipMm,
          condition: c.condition,
        }
      : null,
    forecast_7d: w.days.map((d) => ({
      date: d.date,
      tmax_c: d.tmaxC,
      tmin_c: d.tminC,
      rh_min_pct: d.rhMin,
      rh_max_pct: d.rhMax,
      wind_mean_kph: d.windMeanKph,
      wind_max_kph: d.windMaxKph,
      wind_dir: d.windDir,
      precip_mm: d.precipMm,
      chance_of_rain_pct: d.chanceOfRain,
      et0_mm: d.et0Mm,
      condition: d.condition,
      source: d.source,
    })),
    alerts: w.alerts,
    note: w.note,
  };
}

export async function groundContext(
  context: ChatContext,
  location: { lat: number; lng: number },
  question: string,
): Promise<ChatContext> {
  const weather = await withTimeout(getLocationWeather(location.lat, location.lng), WEATHER_BUDGET_MS, "weather").catch(
    (error: unknown) => {
      console.warn("[chat] Weather unavailable for grounding:", error instanceof Error ? error.message : error);
      return null;
    },
  );
  return {
    ...context,
    land: landContextAt(location.lat, location.lng),
    weather: weather && (weather.current || weather.days.length) ? toWeatherContext(weather) : null,
    knowledge: knowledgeFor(question, 3),
    region_notes: regionNotesFor(question),
  };
}
