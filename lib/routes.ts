/** URLs and URL state shared by server pages and client components. */

/** A farm's workspace: Today (the snapshot) · Advice · AI analysis (the model) · Trends · Probes (daily table and every reading) · Method. */
export const FARM_TABS = [
  { key: "today", label: "Today" },
  { key: "advice", label: "Advice" },
  { key: "ai", label: "AI analysis" },
  { key: "trends", label: "Trends" },
  { key: "probes", label: "Probes" },
  { key: "method", label: "Method" },
] as const;
export type FarmTab = (typeof FARM_TABS)[number]["key"];

/** Probes shows the daily table per probe, or every reading. */
export type ProbesView = "daily" | "readings";

export function isFarmTab(value: unknown): value is FarmTab {
  return typeof value === "string" && FARM_TABS.some((t) => t.key === value);
}

/** The tab (and Probes view) for a `?tab=` value, including the old names: overview → Today, readings → Probes. */
export function parseFarmTab(value: unknown): { tab: FarmTab; view: ProbesView } {
  if (value === "overview") return { tab: "today", view: "daily" };
  if (value === "readings") return { tab: "probes", view: "readings" };
  return { tab: isFarmTab(value) ? value : "today", view: "daily" };
}

/** A farm's workspace, optionally on one tab. */
export function farmTabHref(farmId: string, tab?: FarmTab): string {
  const base = `/dashboard/farm/${encodeURIComponent(farmId)}`;
  return tab && tab !== "today" ? `${base}?tab=${tab}` : base;
}

/** The assistant, scoped to a farm, optionally sending a first question about an insight. */
export function assistantHref(farmId: string, question?: string, insightId?: string): string {
  const q = new URLSearchParams({ farm: farmId });
  if (question) q.set("q", question);
  if (insightId) q.set("insight", insightId);
  return `/dashboard/assistant?${q.toString()}`;
}

/** Farm details → Trends, opened on the chart that explains something. */
export function farmChartHref(farmId: string, chart: string): string {
  return `/dashboard/farm/${encodeURIComponent(farmId)}?tab=trends&chart=${chart}`;
}

/** The Plan shows this week's actions, or next season's crops. */
export type PlanView = "week" | "season";

/** The Plan, for every farm or one, on this week (the default) or next season. */
export function insightsHref(farmId?: string | null, view?: PlanView): string {
  const q = new URLSearchParams();
  if (farmId) q.set("farm", farmId);
  if (view === "season") q.set("view", "season");
  return q.size ? `/dashboard/insights?${q}` : "/dashboard/insights";
}

/**
 * Rewrite the address bar without navigating (browser only). Skipped when nothing changes: Next.js
 * treats `history.replaceState` as a router update, so a needless call can cancel a navigation the
 * user has just started (e.g. tapping a tab while this page is still mounting).
 */
export function replaceUrl(url: string): void {
  const next = new URL(url, window.location.href);
  if (next.pathname === window.location.pathname && next.search === window.location.search) return;
  window.history.replaceState(null, "", next.pathname + next.search + next.hash);
}
