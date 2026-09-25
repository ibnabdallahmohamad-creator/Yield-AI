/** Dashboard tabs (`?tab=`). Plain data so the server page can validate the URL too. */
export const DASHBOARD_TABS = ["overview", "readings", "weather", "temperature", "humidity", "rain", "wind", "insights"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const TAB_LABEL: Record<DashboardTab, string> = {
  overview: "Overview",
  readings: "Readings",
  weather: "Weather",
  temperature: "Temperature",
  humidity: "Humidity",
  rain: "Rain",
  wind: "Wind",
  insights: "AI insights",
};

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === "string" && (DASHBOARD_TABS as readonly string[]).includes(value);
}
