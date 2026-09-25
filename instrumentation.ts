/**
 * Runs once when a server instance starts. Long-running servers (`next start`, `next dev`)
 * refresh every weather forecast every 12 hours; serverless deployments rely on the refresh
 * when a forecast is opened after 12 hours, or on GET /api/cron/weather.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startForecastSchedule } = await import("./lib/weather/schedule");
    startForecastSchedule();
  }
}
