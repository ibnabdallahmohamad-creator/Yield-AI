/**
 * Actions the user has ticked off, kept in this browser (localStorage), so the Plan, a farm's Advice
 * tab, "What to do", Home's "Do first" and the Plan badges all count only what is left.
 *
 * Recommendations have no id, and their titles carry the day and the amounts ("Apply a leaching
 * irrigation on Sunday (+26% water)" becomes "... tomorrow (+17% water)"), so an action is known by
 * its farm and its title without those. A tick lasts for the day on watering actions (the next cycle
 * is a new job) and for a week on the rest. Pure; the browser store is hooks/use-done-actions.ts.
 */
const WATERING = /^(irrigate|next irrigation|apply a leaching)/;
const WEEK_DAYS = 7;

/** Ticked actions: key → the local day ("2026-09-25") it was ticked. */
export type DoneMap = Record<string, string>;

/** Stable identity of one farm's action across days. */
export function actionKey(farmId: string, title: string): string {
  const core = title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/:.*$/, " ")
    .replace(/\b(today|tomorrow|now|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in about \d+ days?)\b/g, " ")
    .replace(/(?<![\w-])[+-]?\d[\d.,]*\s*(mm|%|ds\/m|mg\/kg)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${farmId}|${core}`;
}

/** A short id for the action's anchor on the Advice tab ("#do-apply-a-leaching-irrigation"). */
export function actionAnchor(title: string): string {
  return `do-${actionKey("", title).slice(1).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function localDay(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Whether a tick made on `day` still holds `today`. */
export function tickHolds(key: string, day: string, today: string): boolean {
  const age = daysBetween(day, today);
  if (!(age >= 0)) return false;
  const core = key.slice(key.indexOf("|") + 1);
  return WATERING.test(core) ? age === 0 : age < WEEK_DAYS;
}

/** The ticks that still hold, as a set of keys. */
export function activeTicks(map: DoneMap, today = localDay()): Set<string> {
  return new Set(Object.entries(map).flatMap(([key, day]) => (tickHolds(key, day, today) ? [key] : [])));
}
