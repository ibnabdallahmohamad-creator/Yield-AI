import "server-only";
import { withTimeout } from "../supabase/server";
import type { DashboardData } from "../types";
import { getForecast } from "./service";
import type { PointForecast } from "./types";

/** Don't hold an answer back for the weather: past this, answer without it (the fetch still completes and caches). */
const FORECAST_WAIT_MS = 4000;

/** One farm's cached 12-hourly forecast, or null when it is unavailable. */
export async function farmForecast(data: Pick<DashboardData, "farms">, farmId: string): Promise<PointForecast | null> {
  try {
    const result = await withTimeout(getForecast(data.farms.map((b) => b.farm)), FORECAST_WAIT_MS, "forecast");
    return result.forecast?.points.find((p) => p.id === farmId) ?? null;
  } catch {
    return null;
  }
}
