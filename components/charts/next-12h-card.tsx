/**
 * The next 12 hours at the farm, hour by hour (Open-Meteo, downloaded again at 00:00 and 12:00
 * Qatar time): a temperature curve with every hour's value on it, then rain and wind. One summary
 * line on top says what matters; screen readers get the full table (humidity and gusts included).
 */
import {
  ArrowUp,
  Cloud,
  Droplets,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSun,
  Moon,
  Snowflake,
  Sun,
} from "lucide-react";
import type { HourlyForecast, HourlyPoint } from "@/lib/data/forecast";
import { compassPoint as compass, formatTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Qatar hour (0–23) of an ISO time. */
const qatarHour = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).getUTCHours();

/** WMO weather code → icon and words. Night hours (19:00–05:00) get the moon versions. */
function sky(h: HourlyPoint): { Icon: React.ComponentType<{ className?: string }>; label: string } {
  const code = h.weather_code ?? -1;
  const hour = qatarHour(h.time);
  const night = hour >= 19 || hour < 5;
  if (code >= 95) return { Icon: CloudLightning, label: "Thunderstorm" };
  if (code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82) return { Icon: Snowflake, label: "Snow" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { Icon: CloudRain, label: "Rain" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: "Drizzle" };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: "Fog or haze" };
  if (code === 3) return { Icon: Cloud, label: "Overcast" };
  if (code === 1 || code === 2) return { Icon: night ? CloudMoon : CloudSun, label: "Partly cloudy" };
  if (code === 0) return { Icon: night ? Moon : Sun, label: "Clear" };
  const cloud = h.cloud_pct ?? 0;
  return cloud > 70 ? { Icon: Cloud, label: "Cloudy" } : { Icon: night ? Moon : Sun, label: "Clear" };
}

/** The line on top: the range, the hottest hour, rain, and the strongest wind. */
export function forecastHeadline(f: HourlyForecast): string {
  const s = f.summary;
  const parts: string[] = [];
  if (s.temp_min_c != null && s.temp_max_c != null) {
    parts.push(`${fmtNum(s.temp_min_c, 0)}–${fmtNum(s.temp_max_c, 0)} °C${s.temp_max_at ? `, hottest at ${formatTime(s.temp_max_at)}` : ""}`);
  }
  if (s.humidity_min_pct != null && s.humidity_max_pct != null) parts.push(`humidity ${Math.round(s.humidity_min_pct)}–${Math.round(s.humidity_max_pct)}%`);
  if (s.rain_total_mm >= 0.1) parts.push(`${fmtNum(s.rain_total_mm, 1)} mm of rain over ${s.rain_hours} h`);
  else if ((s.rain_max_prob_pct ?? 0) >= 30) parts.push(`${Math.round(s.rain_max_prob_pct!)}% chance of rain`);
  else parts.push("no rain expected");
  if (s.wind_max_ms != null) {
    parts.push(
      `wind up to ${fmtNum(s.wind_max_ms, 0)} m/s${s.wind_dir_deg != null ? ` from the ${compass(s.wind_dir_deg)}` : ""}${s.gust_max_ms != null ? ` (gusts ${fmtNum(s.gust_max_ms, 0)} m/s)` : ""}`,
    );
  }
  const text = parts.join(" · ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function WindArrow({ deg }: { deg: number | null }) {
  if (deg == null) return null;
  // The arrow points where the wind blows to (it comes from `deg`).
  return <ArrowUp className="inline size-3.5 text-muted-foreground" style={{ transform: `rotate(${deg + 180}deg)` }} aria-hidden="true" />;
}

/** A smooth line through the points (Catmull–Rom as cubic Béziers). */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[Math.max(0, i - 1)];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[Math.min(points.length - 1, i + 2)];
    d += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return d;
}

/** Height of the temperature band and where the curve may sit inside it (px). */
const BAND = 76;
const CURVE_TOP = 30;
const CURVE_BOTTOM = 66;

/**
 * The visual strip: time, sky, a temperature curve with each hour's value on it, then rain chance
 * and wind. Screen readers get the same numbers from the table in `Next12hCard`.
 */
function HourStrip({ forecast }: { forecast: HourlyForecast }) {
  const hours = forecast.hours;
  const n = hours.length;
  const known = hours.map((h) => h.temp_c).filter((t): t is number => t != null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  // At least 6 °C of vertical range, so a flat day doesn't look like a heatwave.
  const span = Math.max(hi - lo, 6);
  const base = (hi + lo) / 2 - span / 2;
  const yOf = (t: number) => CURVE_BOTTOM - ((t - base) / span) * (CURVE_BOTTOM - CURVE_TOP);
  const points: Array<[number, number]> = [];
  hours.forEach((h, i) => {
    if (h.temp_c != null) points.push([(i + 0.5) * 10, yOf(h.temp_c)]);
  });
  const line = smoothPath(points);
  const area = points.length > 1 ? `${line} L${points.at(-1)![0]},${BAND} L${points[0][0]},${BAND} Z` : "";
  const hot = forecast.summary.temp_max_c;
  const gust = forecast.summary.gust_max_ms;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(3.25rem, 1fr))` };

  return (
    <div aria-hidden="true" className="scrollbar-thin -mx-4 mt-4 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5">
      <div className="min-w-max sm:min-w-0">
        <div className="grid text-center" style={cols}>
          {hours.map((h, i) => {
            const { Icon } = sky(h);
            return (
              <div key={h.time} className="flex flex-col items-center gap-1.5">
                <span className={cn("text-xs tabular", i === 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>{i === 0 ? "Now" : formatTime(h.time)}</span>
                <Icon className="size-5 text-muted-foreground" />
              </div>
            );
          })}
        </div>

        <div className="relative" style={{ height: BAND }}>
          <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${n * 10} ${BAND}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="yai-temp-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {area ? <path d={area} fill="url(#yai-temp-fill)" /> : null}
            <path d={line} fill="none" stroke="var(--chart-2)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="absolute inset-0 grid" style={cols}>
            {hours.map((h) => {
              if (h.temp_c == null) return <span key={h.time} />;
              const y = yOf(h.temp_c);
              // Compared as shown: every hour that reads as the peak is marked, not just the exact maximum.
              const hottest = hot != null && Math.round(h.temp_c) === Math.round(hot);
              return (
                <span key={h.time} className="relative">
                  <span
                    className={cn("absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card", hottest ? "bg-risk-high" : "bg-chart-2")}
                    style={{ top: y }}
                  />
                  <span
                    className={cn("absolute left-1/2 -translate-x-1/2 text-sm font-semibold tabular", hottest && "text-risk-high-ink")}
                    style={{ top: y - 26 }}
                  >
                    {fmtNum(h.temp_c, 0)}°
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-2 grid border-t pt-2 text-center text-xs tabular text-muted-foreground" style={cols}>
          {hours.map((h) => {
            const mm = h.precip_mm ?? 0;
            const prob = h.precip_prob_pct ?? 0;
            const wet = mm >= 0.1 || prob >= 30;
            return (
              <div key={h.time} className="flex flex-col items-center gap-1 py-0.5">
                <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", wet && "font-semibold text-chart-3")}>
                  <Droplets className="size-3.5 opacity-70" />
                  {/* Rain in mm when some is expected, else its chance: the unit tells them apart. */}
                  {mm >= 0.1 ? `${fmtNum(mm, 1)} mm` : `${Math.round(prob)}%`}
                </span>
                <span className={cn("inline-flex items-center gap-0.5", h.gust_ms != null && h.gust_ms === gust && gust >= 10 && "font-semibold text-risk-medium-ink")}>
                  <WindArrow deg={h.wind_dir_deg} />
                  {h.wind_ms == null ? "—" : fmtNum(h.wind_ms, 0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Next12hCard({ forecast, className, title = "Next 12 hours" }: { forecast: HourlyForecast | null; className?: string; title?: string }) {
  if (!forecast || forecast.hours.length === 0) {
    return (
      <section className={cn("rounded-2xl border bg-card p-4 shadow-xs sm:p-5", className)}>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">The hourly forecast can&apos;t be loaded right now (Open-Meteo unreachable). It&apos;s retried every 10 minutes.</p>
      </section>
    );
  }
  const hours = forecast.hours;
  return (
    <section className={cn("relative rounded-2xl border bg-card p-4 shadow-xs sm:p-5", className)} aria-labelledby="next12h-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="next12h-title" className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Droplets className="size-3.5" aria-hidden="true" /> rain chance or mm
          </span>
          {" · "}
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3.5 rotate-45" aria-hidden="true" /> wind m/s
          </span>
        </p>
      </div>
      <p className="mt-1 text-sm text-pretty">{forecastHeadline(forecast)}</p>

      <HourStrip forecast={forecast} />
      <p className="mt-2 text-xs text-muted-foreground">
        Open-Meteo · updated {formatTime(forecast.fetched_at)} · next update {formatTime(forecast.next_refresh_at)}
        {forecast.stale ? " · couldn't refresh, showing the previous forecast" : ""}
      </p>

      {/* The same numbers for screen readers (a table ignores sr-only's 1 px width, so wrap it). */}
      <div className="sr-only">
        <table>
          <caption>Hourly forecast for the next {hours.length} hours, Qatar time</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Sky</th>
              <th scope="col">Temperature °C</th>
              <th scope="col">Humidity %</th>
              <th scope="col">Rain</th>
              <th scope="col">Wind m/s</th>
              <th scope="col">Gusts m/s</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.time}>
                <th scope="row">{formatTime(h.time)}</th>
                <td>{sky(h).label}</td>
                <td>{h.temp_c == null ? "—" : fmtNum(h.temp_c, 0)}</td>
                <td>{h.humidity_pct == null ? "—" : Math.round(h.humidity_pct)}</td>
                <td>
                  {h.precip_mm != null && h.precip_mm >= 0.1 ? `${fmtNum(h.precip_mm, 1)} mm` : "none"}
                  {h.precip_prob_pct != null ? `, ${Math.round(h.precip_prob_pct)}% chance` : ""}
                </td>
                <td>
                  {h.wind_ms == null ? "—" : fmtNum(h.wind_ms, 0)}
                  {h.wind_dir_deg != null ? ` from the ${compass(h.wind_dir_deg)}` : ""}
                </td>
                <td>{h.gust_ms == null ? "—" : fmtNum(h.gust_ms, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
