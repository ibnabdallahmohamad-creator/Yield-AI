"use client";

/**
 * The weather map's timeline (Windy-style): play/pause, an hourly track over the forecast with day
 * labels at midnight, night shading from the real sunset and sunrise, and behind the track a strip of
 * the layer's value at the chosen spot, coloured like the map, so the peaks are visible before
 * scrubbing to them. The track is a native range input (arrow keys step an hour).
 */
import { Pause, Play } from "lucide-react";
import { useId, useMemo } from "react";
import { formatDay, formatTime, fmtNum, qatarDay } from "@/lib/format";
import { formatWeather, type WeatherLayerDef } from "@/lib/weather/layers";
import { paletteColor } from "@/lib/weather/palettes";
import { nightSpans } from "@/lib/weather/sun";
import { cn } from "@/lib/utils";

const iso = (ms: number) => new Date(ms).toISOString();
/** "Fri 25 Sep, 15:00" (Qatar time). */
export const hourLabel = (ms: number) => `${formatDay(qatarDay(iso(ms)))}, ${formatTime(iso(ms))}`;

export function WeatherTimeline({
  times,
  t,
  onT,
  playing,
  onPlayingChange,
  strip,
  def,
  place,
  lat,
  lng,
  className,
}: {
  times: number[];
  t: number;
  onT: (t: number) => void;
  playing: boolean;
  onPlayingChange: (on: boolean) => void;
  /** The layer's value at the spot, one per hour (null: no strip). */
  strip: number[] | null;
  def: WeatherLayerDef;
  /** Name of the spot the strip describes. */
  place: string;
  lat: number;
  lng: number;
  className?: string;
}) {
  const id = useId();
  const n = times.length;
  const last = Math.max(1, n - 1);
  const pos = (i: number) => (i / last) * 100;
  const now = Math.round(t);

  const days = useMemo(() => {
    const out: Array<{ i: number; label: string }> = [];
    let prev = "";
    times.forEach((ms, i) => {
      const day = qatarDay(iso(ms));
      if (day !== prev) {
        // Label a day at its midnight (or at the start of the timeline).
        out.push({ i, label: formatDay(day).replace(/ \w+$/, "") });
        prev = day;
      }
    });
    return out;
  }, [times]);

  const nights = useMemo(() => (n > 1 ? nightSpans(times[0], times[n - 1], lat, lng) : []), [times, n, lat, lng]);
  const toX = (ms: number) => ((ms - times[0]) / (times[n - 1] - times[0] || 1)) * 100;

  const shape = useMemo(() => {
    if (!strip || strip.length !== n) return null;
    const vals = strip.filter(Number.isFinite);
    if (vals.length < 2) return null;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const minSpan = def.key === "temp" || def.key === "feels" || def.key === "dew" ? 6 : def.unit === "%" ? 20 : def.key === "pressure" ? 4 : 2;
    if (hi - lo < minSpan) {
      const mid = def.key === "rain" || def.key === "rainAccum" || def.key === "precipProb" ? lo + minSpan / 2 : (hi + lo) / 2;
      lo = Math.max(def.key === "rain" || def.key === "rainAccum" || def.key === "precipProb" ? 0 : -Infinity, mid - minSpan / 2);
      hi = lo + minSpan;
    }
    const y = (v: number) => 30 - ((v - lo) / (hi - lo)) * 26;
    const pts = strip.map((v, i) => `${pos(i).toFixed(3)},${(Number.isFinite(v) ? y(v) : 30).toFixed(2)}`);
    const peak = strip.reduce((best, v, i) => (Number.isFinite(v) && (best < 0 || v > strip[best]) ? i : best), -1);
    return { line: `M${pts.join(" L")}`, area: `M0,30 L${pts.join(" L")} L100,30 Z`, peak, peakY: peak >= 0 ? y(strip[peak]) : 0 };
    // pos depends only on n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip, n, def]);

  const current = times[Math.min(n - 1, Math.max(0, now))];
  const valueNow = strip?.[Math.min(n - 1, Math.max(0, now))];

  return (
    <div className={cn("flex items-stretch gap-2.5 rounded-2xl bg-card/96 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur-sm sm:gap-3 sm:p-2.5", className)}>
      <button
        type="button"
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? "Pause the forecast animation" : "Play the forecast hour by hour"}
        className="flex size-11 shrink-0 items-center justify-center self-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:outline-none sm:size-10"
      >
        {playing ? <Pause className="size-4.5" aria-hidden="true" /> : <Play className="ml-0.5 size-4.5" aria-hidden="true" />}
      </button>

      <div className="relative min-w-0 flex-1">
        {/* Day labels */}
        <div className="relative mx-[7px] h-4 text-xs leading-4 font-semibold text-muted-foreground" aria-hidden="true">
          {days.map((d, k) => (
            <span
              key={d.i}
              className={cn("absolute truncate pl-1", k === 0 ? "" : "border-l border-foreground/25")}
              style={{ left: `${pos(d.i)}%`, maxWidth: `${pos((days[k + 1]?.i ?? n - 1) - d.i)}%` }}
            >
              {d.label}
            </span>
          ))}
        </div>
        {/* Strip: nights, the value at the spot, the current hour */}
        <div className="relative mx-[7px] mt-0.5 h-8 overflow-hidden rounded-md bg-muted/60" aria-hidden="true">
          <svg className="absolute inset-0 size-full" viewBox="0 0 100 30" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" x2="1" y1="0" y2="0">
                {strip && shape
                  ? strip.map((v, i) => {
                      const c = paletteColor(def.palette, Number.isFinite(v) ? v : def.legend.min);
                      return <stop key={i} offset={`${pos(i)}%`} stopColor={`rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`} stopOpacity={Math.max(0.35, c[3] / 255)} />;
                    })
                  : null}
              </linearGradient>
            </defs>
            {nights.map(([a, b]) => (
              <rect key={a} x={toX(a)} width={Math.max(0, toX(b) - toX(a))} y={0} height={30} fill="oklch(0.25 0.03 250 / 0.14)" />
            ))}
            {days.slice(1).map((d) => (
              <line key={d.i} x1={pos(d.i)} x2={pos(d.i)} y1={0} y2={30} stroke="oklch(0.3 0.02 120 / 0.25)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ))}
            {shape ? (
              <>
                <path d={shape.area} fill={`url(#${id}-fill)`} fillOpacity={0.85} />
                <path d={shape.line} fill="none" stroke="oklch(0.25 0.03 160 / 0.7)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
              </>
            ) : null}
            <line x1={pos(t)} x2={pos(t)} y1={0} y2={30} stroke="oklch(0.2 0.03 160)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
          {shape && shape.peak >= 0 && strip ? (
            <span
              className="absolute -translate-x-1/2 rounded bg-card/90 px-1 text-xs leading-4 font-semibold tabular shadow-sm"
              style={{ left: `${Math.min(94, Math.max(6, pos(shape.peak)))}%`, top: Math.max(0, (shape.peakY / 30) * 32 - 17) }}
            >
              {formatWeather(def, strip[shape.peak], false)}
            </span>
          ) : null}
        </div>
        <label htmlFor={`${id}-range`} className="sr-only">
          Forecast hour
        </label>
        <input
          id={`${id}-range`}
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={Math.min(n - 1, Math.max(0, now))}
          onChange={(e) => {
            if (playing) onPlayingChange(false);
            onT(Number(e.target.value));
          }}
          aria-valuetext={`${hourLabel(current)}${valueNow != null && Number.isFinite(valueNow) ? `, ${def.short} ${formatWeather(def, valueNow)} at ${place}` : ""}`}
          className="yai-wx-range absolute inset-x-0 top-4 h-8 w-full cursor-pointer"
        />
      </div>

      <div className="hidden w-28 shrink-0 flex-col justify-center text-right sm:flex" aria-live="off">
        <span className="text-sm font-semibold tabular">{formatTime(iso(current))}</span>
        <span className="truncate text-xs text-muted-foreground">{formatDay(qatarDay(iso(current)))}</span>
        {valueNow != null && Number.isFinite(valueNow) ? (
          <span className="truncate text-xs text-muted-foreground tabular">
            {def.short} {formatWeather(def, valueNow)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** "+5 h" from the first hour, for compact labels. */
export const hoursAhead = (t: number) => (t < 0.5 ? "Now" : `+${fmtNum(t, 0)} h`);
