/** Qatar is UTC+3 all year (no daylight saving). All "days" in the app are Asia/Qatar local days. */
export const QATAR_UTC_OFFSET_H = 3;
export const QATAR_TIMEZONE = "Asia/Qatar";
const DAY_MS = 86_400_000;

/** Local (Asia/Qatar) calendar date `YYYY-MM-DD` for an instant. */
export function qatarDateString(instant: Date | string | number): string {
  const t = new Date(instant).getTime() + QATAR_UTC_OFFSET_H * 3_600_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Local hour (0–23) in Qatar for an instant. */
export function qatarHour(instant: Date | string | number): number {
  const t = new Date(instant).getTime() + QATAR_UTC_OFFSET_H * 3_600_000;
  return new Date(t).getUTCHours();
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Inclusive list of `count` consecutive dates ending at `end`. */
export function dateRangeEnding(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - (count - 1)));
}

/** UTC instant for a local Qatar date and hour. */
export function qatarLocalToUtc(date: string, hour: number, minute = 0): Date {
  const t = Date.parse(`${date}T00:00:00Z`) + (hour - QATAR_UTC_OFFSET_H) * 3_600_000 + minute * 60_000;
  return new Date(t);
}
