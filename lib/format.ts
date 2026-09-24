/**
 * Display formatting shared by server and client components. Days are Asia/Qatar local dates
 * (`YYYY-MM-DD`). Date labels are built by hand (not Intl) so the server and the browser always
 * render identical text — no hydration mismatches between ICU versions.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const QATAR_OFFSET_MS = 3 * 3600_000;

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Thu 24 Sep" */
export function formatDay(date: string): string {
  const p = parts(date);
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** "24 Sep" */
export function formatShortDay(date: string): string {
  const p = parts(date);
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

/** "Thursday 24 September" */
export function formatLongDay(date: string): string {
  const p = parts(date);
  return `${WEEKDAYS_LONG[p.wd]} ${p.d} ${MONTHS_LONG[p.m - 1]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:05" in Qatar time (UTC+3, no daylight saving). */
export function formatTime(iso: string): string {
  const t = new Date(Date.parse(iso) + QATAR_OFFSET_MS);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** "14:05:09" in Qatar time. */
export function formatTimeSeconds(iso: string): string {
  const t = new Date(Date.parse(iso) + QATAR_OFFSET_MS);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

/** Qatar local day (YYYY-MM-DD) of an ISO timestamp. */
export function qatarDay(iso: string): string {
  return new Date(Date.parse(iso) + QATAR_OFFSET_MS).toISOString().slice(0, 10);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function initials(name: string): string {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "Y";
}

export function fmtNum(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
