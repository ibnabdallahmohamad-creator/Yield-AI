/** The 12-hourly forecast job for long-running servers (started from instrumentation.ts). */
import "server-only";
import { FORECAST_TTL_MS, refreshAllForecasts } from "./service";

const WARM_UP_DELAY_MS = 20_000;
const globalSchedule = globalThis as unknown as { __yieldForecastTimer?: ReturnType<typeof setInterval> };

async function run(reason: string) {
  try {
    const { ok, failed, total } = await refreshAllForecasts();
    console.log(`[weather] ${reason}: ${ok}/${total} forecasts current${failed ? `, ${failed} failed` : ""}.`);
  } catch (error) {
    console.warn("[weather] Scheduled refresh failed:", error instanceof Error ? error.message : error);
  }
}

export function startForecastSchedule(): void {
  if (process.env.OPEN_METEO_DISABLED === "true" || globalSchedule.__yieldForecastTimer) return;
  // Serverless instances are short-lived: they refresh on demand instead of on a timer.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  const warmUp = setTimeout(() => void run("Start-up refresh"), WARM_UP_DELAY_MS);
  warmUp.unref?.();
  globalSchedule.__yieldForecastTimer = setInterval(() => void run("12-hourly refresh"), FORECAST_TTL_MS);
  globalSchedule.__yieldForecastTimer.unref?.();
}
