/**
 * Runs once when the server starts. On a long-running Node server (`next start`, `next dev`) it
 * schedules the 12-hour weather refresh: at every 00:00 and 12:00 Asia/Qatar the hourly forecast is
 * downloaded again for every farm location in use (lib/data/forecast.ts). Serverless hosts refresh on
 * first use in each half-day instead, or from GET /api/cron/weather.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.OPEN_METEO_DISABLED === "true") return;
  const { nextRefreshAt, refreshTrackedForecasts } = await import("./lib/data/forecast");

  const g = globalThis as typeof globalThis & { __yieldForecastTimer?: ReturnType<typeof setTimeout> };
  if (g.__yieldForecastTimer) clearTimeout(g.__yieldForecastTimer);

  const schedule = () => {
    // A few seconds past the boundary, so the new half-day has certainly started.
    const wait = Math.max(1000, nextRefreshAt(Date.now()) - Date.now() + 5000);
    g.__yieldForecastTimer = setTimeout(async () => {
      try {
        const { locations, ok } = await refreshTrackedForecasts();
        if (locations) console.log(`[forecast] 12-hour refresh: ${ok}/${locations} locations updated`);
      } catch (error) {
        console.warn("[forecast] 12-hour refresh failed:", error instanceof Error ? error.message : error);
      }
      schedule();
    }, wait);
    g.__yieldForecastTimer.unref?.();
  };
  schedule();
}
