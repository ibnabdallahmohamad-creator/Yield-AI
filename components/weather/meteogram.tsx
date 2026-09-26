"use client";

/**
 * A Windy-style meteogram for one spot. It stacks 72 hours of weather on one time axis:
 * - temperature, coloured like the map, with feels-like, dew point and each day's high and low
 * - rain bars with the chance of rain
 * - wind with its gust band and direction arrows
 * - cloud, humidity, and an hour-by-hour spraying strip
 * Night is shaded from the real sunset and sunrise. Hovering, tapping or the arrow keys read every
 * row at one hour; a click or Enter moves the map's timeline to that hour.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { C, niceScale, TooltipRow, TooltipShell, type Scale } from "@/components/charts/chart-kit";
import { compassPoint, fmtNum, formatDay, qatarDay } from "@/lib/format";
import type { PointHour } from "@/lib/weather/field";
import { beaufort, kmh } from "@/lib/weather/layers";
import { paletteColor, PALETTES, type Palette, type Rgba } from "@/lib/weather/palettes";
import { nightSpans } from "@/lib/weather/sun";
import { goodWindows, sprayForHour, type SprayTone } from "@/lib/weather/work-windows";
import { cn } from "@/lib/utils";
import { hourLabel } from "./weather-timeline";

const HOUR = 3_600_000;
const QATAR_OFFSET = 3 * HOUR;
/** Left gutter (y labels) and right gutter (rain chance). */
const GL = 38;
const GR = 34;
/** Narrower than this and the chart scrolls sideways instead of squeezing the hours. */
const MIN_WIDTH = 620;

const TEMP_LINE = "oklch(0.3 0.03 160 / 0.35)";
const FEELS = "oklch(0.62 0.15 45)";
const DEW = "oklch(0.55 0.1 200)";
const HUMID = "oklch(0.52 0.1 230)";
const CLOUD = "oklch(0.48 0.015 250)";
const NIGHT = "oklch(0.32 0.04 265 / 0.07)";
const SPRAY_FILL: Record<SprayTone, string> = { good: "var(--risk-low)", fair: "var(--risk-medium)", poor: "var(--risk-high)" };
const HALO = { paintOrder: "stroke" as const, stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" as const };

const rgb = (c: Rgba) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const iso = (ms: number) => new Date(ms).toISOString();
const qatarHour = (ms: number) => new Date(ms + QATAR_OFFSET).getUTCHours();

interface Band {
  top: number;
  h: number;
  bottom: number;
}

/** Row positions, top to bottom; each panel gets a title line above it. */
function layout() {
  let y = 0;
  const row = (h: number, gapAfter = 0): Band => {
    const r = { top: y, h, bottom: y + h };
    y += h + gapAfter;
    return r;
  };
  const days = row(20);
  const hours = row(16, 22);
  const temp = row(150, 26);
  const rain = row(58, 26);
  const arrows = row(20);
  const wind = row(96, 26);
  const cloud = row(10, 5);
  const rh = row(46, 26);
  const spray = row(14, 4);
  return { days, hours, temp, rain, arrows, wind, cloud, rh, spray, height: y };
}
const ROWS = layout();

/** A monotone cubic path through the points (Fritsch–Carlson: no overshoot between hourly values). */
function monotonePath(pts: Array<[number, number]>, move = true): string {
  const n = pts.length;
  if (n === 0) return "";
  const p = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  let d = `${move ? "M" : "L"}${p(pts[0][0], pts[0][1])}`;
  if (n === 1) return d;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const tan: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    tan.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  }
  tan.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${p(pts[i][0] + h, pts[i][1] + tan[i] * h)} ${p(pts[i + 1][0] - h, pts[i + 1][1] - tan[i + 1] * h)} ${p(pts[i + 1][0], pts[i + 1][1])}`;
  }
  return d;
}

function yScale(scale: Scale, band: Band) {
  const [lo, hi] = scale.domain;
  return (v: number) => band.bottom - ((v - lo) / (hi - lo || 1)) * band.h;
}

/** A vertical gradient that colours a line by its value, like the map. */
function PaletteGradient({ id, palette, band, domain }: { id: string; palette: Palette; band: Band; domain: [number, number] }) {
  const stops = 14;
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={band.bottom} y2={band.top}>
      {Array.from({ length: stops }, (_, k) => {
        const v = domain[0] + ((domain[1] - domain[0]) * k) / (stops - 1);
        return <stop key={k} offset={k / (stops - 1)} stopColor={rgb(paletteColor(palette, v))} />;
      })}
    </linearGradient>
  );
}

/** At most `max` ticks, keeping 0 and an even spacing. */
function thin(ticks: number[], max: number): number[] {
  if (ticks.length <= max) return ticks;
  const k = Math.ceil((ticks.length - 1) / (max - 1));
  return ticks.filter((_, i) => i % k === 0);
}

function GridLines({
  scale,
  y,
  x0,
  x1,
  unit = "",
  right,
  max = 6,
}: {
  scale: Scale;
  y: (v: number) => number;
  x0: number;
  x1: number;
  unit?: string;
  right?: boolean;
  max?: number;
}) {
  return (
    <g aria-hidden="true">
      {thin(scale.ticks, max).map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={y(v)} y2={y(v)} stroke={C.grid} />
          <text x={right ? x1 + 6 : x0 - 6} y={y(v) + 4} fontSize={12} fill={C.axis} textAnchor={right ? "start" : "end"} className="tabular">
            {v.toLocaleString("en-US", { maximumFractionDigits: scale.decimals })}
            {unit}
          </text>
        </g>
      ))}
    </g>
  );
}

function Title({ x, band, children }: { x: number; band: Band; children: React.ReactNode }) {
  return (
    <text x={x} y={band.top - 9} fontSize={12} fontWeight={600} fill="var(--foreground)" {...HALO}>
      {children}
    </text>
  );
}

export function Meteogram({
  hours,
  t,
  onT,
  lat,
  lng,
  place,
  className,
}: {
  hours: PointHour[];
  /** The map's timeline position (fractional hour), drawn as a line. */
  t: number;
  onT?: (hour: number) => void;
  lat: number;
  lng: number;
  place: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [scrollX, setScrollX] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Fires once on observe too, with the first size.
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = hours.length;
  const W = Math.max(MIN_WIDTH, width);
  const x0 = GL;
  const x1 = W - GR;
  const pph = (x1 - x0) / Math.max(1, n);
  const xc = (i: number) => x0 + (i + 0.5) * pph;
  const xMs = (ms: number) => (n ? Math.min(x1, Math.max(x0, x0 + ((ms - hours[0].time) / HOUR + 0.5) * pph)) : x0);

  const model = useMemo(() => {
    if (n < 2) return null;
    const temps = hours.flatMap((h) => [h.temp, h.feels, h.dew]);
    const tempScale = niceScale(temps, { minSpan: 10 });
    const rainScale = niceScale(
      hours.map((h) => h.precip),
      { minSpan: 1, zero: true },
    );
    const windScale = niceScale(
      hours.flatMap((h) => [h.wind, h.gust]),
      { minSpan: 8, zero: true },
    );
    const rhScale: Scale = { domain: [0, 100], ticks: [0, 50, 100], decimals: 0 };
    const spray = hours.map((h) => sprayForHour(h));

    // Qatar days: where each starts, and its high and low.
    const days: Array<{ from: number; to: number; day: string; hi: number; lo: number }> = [];
    hours.forEach((h, i) => {
      const day = qatarDay(iso(h.time));
      const cur = days[days.length - 1];
      if (!cur || cur.day !== day) days.push({ from: i, to: i, day, hi: i, lo: i });
      else {
        cur.to = i;
        if (h.temp > hours[cur.hi].temp) cur.hi = i;
        if (h.temp < hours[cur.lo].temp) cur.lo = i;
      }
    });
    const nights = nightSpans(hours[0].time - HOUR / 2, hours[n - 1].time + HOUR / 2, lat, lng);
    const windows = goodWindows(hours, 2);
    return { tempScale, rainScale, windScale, rhScale, spray, days, nights, windows };
  }, [hours, n, lat, lng]);

  const at = hover ?? null;

  if (!model) return <div ref={wrap} className={cn("h-40", className)} />;
  const { tempScale, rainScale, windScale, rhScale, spray, days, nights, windows } = model;

  const yT = yScale(tempScale, ROWS.temp);
  const yR = yScale(rainScale, ROWS.rain);
  const yP = (v: number) => ROWS.rain.bottom - (v / 100) * ROWS.rain.h;
  const yW = yScale(windScale, ROWS.wind);
  const yH = yScale(rhScale, ROWS.rh);

  const pts = (get: (h: PointHour) => number, y: (v: number) => number) =>
    hours.flatMap((h, i): Array<[number, number]> => (Number.isFinite(get(h)) ? [[xc(i), y(get(h))]] : []));
  const area = (line: Array<[number, number]>, base: number) =>
    line.length ? `${monotonePath(line)}L${line[line.length - 1][0].toFixed(1)},${base}L${line[0][0].toFixed(1)},${base}Z` : "";

  const tempPts = pts((h) => h.temp, yT);
  const windPts = pts((h) => h.wind, yW);
  const gustPts = pts((h) => h.gust, yW);
  const gustBand = gustPts.length && windPts.length ? `${monotonePath(gustPts)}${monotonePath([...windPts].reverse(), false)}Z` : "";
  const rhPts = pts((h) => h.rh, yH);
  const probStep =
    hours.map((h, i) => `${i === 0 ? "M" : "L"}${(x0 + i * pph).toFixed(1)},${yP(h.precipProb || 0).toFixed(1)}H${(x0 + (i + 1) * pph).toFixed(1)}`).join("") || "";
  const dry = hours.every((h) => h.precip < 0.05) && Math.max(...hours.map((h) => h.precipProb || 0)) < 10;

  const hourStep = pph >= 16 ? 3 : pph >= 8 ? 6 : 12;
  const arrowStep = pph >= 12 ? 2 : pph >= 7 ? 3 : 6;
  const tIdx = Math.min(n - 1, Math.max(0, t));
  const heat = tempScale.domain[1] >= 40 ? 40 : tempScale.domain[1] >= 35 ? 35 : null;
  const drift = windScale.domain[1] >= 5.5 ? 5.5 : null;

  const best = windows[0];
  const bestText = best
    ? `best ${formatDay(qatarDay(iso(hours[best.from].time))).replace(/ \w+$/, "")} ${fmtHour(hours[best.from].time)}–${fmtHour(hours[best.to].time + HOUR)}`
    : "no good window in the next 3 days";

  const summary = `${n}-hour forecast at ${place}: ${fmtNum(Math.min(...hours.map((h) => h.temp)), 0)} to ${fmtNum(Math.max(...hours.map((h) => h.temp)), 0)} °C, ${fmtNum(
    hours.reduce((s, h) => s + h.precip, 0),
    1,
  )} mm of rain, gusts up to ${fmtNum(Math.max(...hours.map((h) => h.gust)), 0)} m/s. Spraying: ${bestText}.`;

  const pick = (clientX: number) => {
    const r = wrap.current?.querySelector("svg")?.getBoundingClientRect();
    if (!r) return null;
    const i = Math.floor((clientX - r.left - x0) / pph);
    return i >= 0 && i < n ? i : null;
  };

  const tip = at != null ? hours[at] : null;
  const tipRight = at != null && xc(at) > W * 0.6;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={wrap}
        className="relative overflow-x-auto overscroll-x-contain rounded-lg focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        tabIndex={0}
        role="group"
        aria-label={`Forecast chart for ${place}. Use the left and right arrow keys to read each hour; Enter shows that hour on the map.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const step = e.shiftKey ? 6 : 1;
            setHover((h) => Math.min(n - 1, Math.max(0, (h ?? Math.round(tIdx)) + (e.key === "ArrowRight" ? step : -step))));
          } else if (e.key === "Enter" && hover != null) onT?.(hover);
          else if (e.key === "Escape") setHover(null);
        }}
        onBlur={() => setHover(null)}
        onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
      >
        <svg
          width={W}
          height={ROWS.height}
          className="block select-none"
          role="img"
          aria-label={summary}
          onPointerMove={(e) => setHover(pick(e.clientX))}
          onPointerDown={(e) => setHover(pick(e.clientX))}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          onClick={(e) => {
            const i = pick(e.clientX);
            if (i != null) onT?.(i);
          }}
        >
          <defs>
            <PaletteGradient id={`${id}-t`} palette={PALETTES.temp} band={ROWS.temp} domain={tempScale.domain} />
            <PaletteGradient id={`${id}-w`} palette={PALETTES.wind} band={ROWS.wind} domain={windScale.domain} />
            <clipPath id={`${id}-clip`}>
              <rect x={x0} y={0} width={x1 - x0} height={ROWS.height} />
            </clipPath>
          </defs>

          {/* Nights and midnights behind everything */}
          <g clipPath={`url(#${id}-clip)`} aria-hidden="true">
            {nights.map(([a, b]) => (
              <rect key={a} x={xMs(a)} width={Math.max(0, xMs(b) - xMs(a))} y={ROWS.hours.top} height={ROWS.spray.bottom - ROWS.hours.top} fill={NIGHT} />
            ))}
            {days.slice(1).map((d) => (
              <line key={d.from} x1={x0 + d.from * pph} x2={x0 + d.from * pph} y1={ROWS.days.top} y2={ROWS.spray.bottom} stroke="oklch(0.3 0.02 120 / 0.22)" />
            ))}
          </g>

          {/* Day and hour labels */}
          <g aria-hidden="true">
            {days.map((d) => {
              const a = x0 + d.from * pph;
              const b = x0 + (d.to + 1) * pph;
              const wide = b - a > 120;
              const label = wide ? formatDay(d.day) : b - a > 44 ? formatDay(d.day).split(" ")[0] : "";
              return (
                <text key={d.day} x={(a + b) / 2} y={ROWS.days.top + 14} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--foreground)">
                  {label}
                </text>
              );
            })}
            {hours.map((h, i) =>
              qatarHour(h.time) % hourStep === 0 ? (
                <text key={h.time} x={xc(i)} y={ROWS.hours.top + 11} textAnchor="middle" fontSize={12} fill={C.axis} className="tabular">
                  {String(qatarHour(h.time)).padStart(2, "0")}
                </text>
              ) : null,
            )}
          </g>

          {/* Temperature */}
          <Title x={x0} band={ROWS.temp}>
            Temperature <tspan fill={C.axis} fontWeight={400}>°C</tspan>
          </Title>
          <GridLines scale={tempScale} y={yT} x0={x0} x1={x1} unit="°" />
          {heat != null ? (
            <g aria-hidden="true">
              <line x1={x0} x2={x1} y1={yT(heat)} y2={yT(heat)} stroke={C.threshold} strokeDasharray="2 3" strokeOpacity={0.55} />
              <text x={x1 - 4} y={yT(heat) - 4} textAnchor="end" fontSize={12} fontWeight={600} fill={C.threshold} {...HALO}>
                {heat === 40 ? "40° heat stress" : "35° hot"}
              </text>
            </g>
          ) : null}
          <path d={area(tempPts, ROWS.temp.bottom)} fill={`url(#${id}-t)`} fillOpacity={0.22} />
          <path d={monotonePath(pts((h) => h.dew, yT))} fill="none" stroke={DEW} strokeWidth={1.5} />
          <path d={monotonePath(pts((h) => h.feels, yT))} fill="none" stroke={FEELS} strokeWidth={1.5} strokeDasharray="5 3" />
          <path d={monotonePath(tempPts)} fill="none" stroke={TEMP_LINE} strokeWidth={4.5} strokeLinecap="round" />
          <path d={monotonePath(tempPts)} fill="none" stroke={`url(#${id}-t)`} strokeWidth={2.75} strokeLinecap="round" />
          {days.map((d) =>
            d.to - d.from >= 5 ? (
              <g key={d.day} aria-hidden="true">
                {[d.hi, d.lo].map((i, k) => {
                  const y = yT(hours[i].temp);
                  const ty = k === 0 ? Math.max(ROWS.temp.top + 11, y - 9) : Math.min(ROWS.temp.bottom - 3, y + 17);
                  return (
                    <g key={k}>
                      <circle cx={xc(i)} cy={y} r={3} fill={rgb(paletteColor(PALETTES.temp, hours[i].temp))} stroke="var(--card)" strokeWidth={1.5} />
                      <text x={xc(i)} y={ty} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--foreground)" className="tabular" {...HALO}>
                        {Math.round(hours[i].temp)}°
                      </text>
                    </g>
                  );
                })}
              </g>
            ) : null,
          )}

          {/* Rain */}
          <Title x={x0} band={ROWS.rain}>
            Rain <tspan fill={C.axis} fontWeight={400}>mm · chance %</tspan>
          </Title>
          <GridLines scale={rainScale} y={yR} x0={x0} x1={x1} max={2} />
          <g aria-hidden="true">
            {[50, 100].map((v) => (
              <text key={v} x={x1 + 6} y={yP(v) + 4} fontSize={12} fill={C.rain} className="tabular">
                {v}%
              </text>
            ))}
          </g>
          <path d={`${probStep}V${ROWS.rain.bottom}H${x0}Z`} fill={C.rain} fillOpacity={0.08} />
          <path d={probStep} fill="none" stroke={C.rain} strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray="3 2" />
          {hours.map((h, i) =>
            h.precip >= 0.05 ? (
              <rect
                key={h.time}
                x={xc(i) - Math.max(1.5, pph * 0.36)}
                width={Math.max(3, pph * 0.72)}
                y={yR(h.precip)}
                height={Math.max(1, ROWS.rain.bottom - yR(h.precip))}
                rx={1}
                fill={C.rain}
              />
            ) : null,
          )}
          {dry ? (
            <text x={x0 + 10} y={ROWS.rain.top + ROWS.rain.h / 2 + 4} fontSize={12} fill={C.axis}>
              Dry: no rain expected
            </text>
          ) : null}

          {/* Wind */}
          <Title x={x0} band={ROWS.arrows}>
            Wind <tspan fill={C.axis} fontWeight={400}>m/s · gust band · arrows show where it blows</tspan>
          </Title>
          <g aria-hidden="true">
            {hours.map((h, i) =>
              i % arrowStep === 0 && Number.isFinite(h.windDir) ? (
                <path
                  key={h.time}
                  d="M0,-7.5L4.8,4L0,1.2L-4.8,4Z"
                  transform={`translate(${xc(i).toFixed(1)},${ROWS.arrows.top + 10}) rotate(${f1(h.windDir + 180)}) scale(${Math.min(1.25, 0.8 + h.wind / 16).toFixed(2)})`}
                  fill={rgb(paletteColor(PALETTES.wind, h.wind))}
                  stroke="oklch(0.25 0.03 160 / 0.55)"
                  strokeWidth={0.8}
                  strokeLinejoin="round"
                />
              ) : null,
            )}
          </g>
          <GridLines scale={windScale} y={yW} x0={x0} x1={x1} max={4} />
          {drift != null ? (
            <g aria-hidden="true">
              <line x1={x0} x2={x1} y1={yW(drift)} y2={yW(drift)} stroke={C.threshold} strokeDasharray="2 3" strokeOpacity={0.55} />
              <text x={x1 - 4} y={yW(drift) - 4} textAnchor="end" fontSize={12} fontWeight={600} fill={C.threshold} {...HALO}>
                Spray drift limit
              </text>
            </g>
          ) : null}
          <path d={gustBand} fill={`url(#${id}-w)`} fillOpacity={0.3} />
          <path d={monotonePath(gustPts)} fill="none" stroke={C.axis} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="2 2" />
          <path d={monotonePath(windPts)} fill="none" stroke={TEMP_LINE} strokeWidth={4.5} strokeLinecap="round" />
          <path d={monotonePath(windPts)} fill="none" stroke={`url(#${id}-w)`} strokeWidth={2.75} strokeLinecap="round" />

          {/* Cloud and humidity */}
          <Title x={x0} band={ROWS.cloud}>
            Cloud <tspan fill={C.axis} fontWeight={400}>and</tspan> humidity <tspan fill={C.axis} fontWeight={400}>%</tspan>
          </Title>
          <rect x={x0} y={ROWS.cloud.top} width={x1 - x0} height={ROWS.cloud.h} rx={2} fill="var(--muted)" />
          {hours.map((h, i) =>
            h.cloud >= 3 ? (
              <rect key={h.time} x={x0 + i * pph} width={pph + 0.5} y={ROWS.cloud.top} height={ROWS.cloud.h} fill={CLOUD} fillOpacity={Math.min(0.85, (h.cloud / 100) * 0.9)} />
            ) : null,
          )}
          <GridLines scale={rhScale} y={yH} x0={x0} x1={x1} unit="%" />
          <path d={area(rhPts, ROWS.rh.bottom)} fill={HUMID} fillOpacity={0.12} />
          <path d={monotonePath(rhPts)} fill="none" stroke={HUMID} strokeWidth={2} />

          {/* Spraying */}
          <Title x={x0} band={ROWS.spray}>
            Spraying <tspan fill={C.axis} fontWeight={400}>· {bestText}</tspan>
          </Title>
          {spray.map((s, i) => (
            <rect key={i} x={x0 + i * pph + 0.35} width={Math.max(0.5, pph - 0.7)} y={ROWS.spray.top} height={ROWS.spray.h} fill={SPRAY_FILL[s.tone]} fillOpacity={s.tone === "good" ? 0.9 : 0.55} />
          ))}

          {/* The map's hour */}
          <g aria-hidden="true">
            <line x1={xc(tIdx)} x2={xc(tIdx)} y1={ROWS.hours.bottom} y2={ROWS.spray.bottom} stroke={C.today} strokeWidth={1.5} />
            <path d={`M${xc(tIdx) - 5},${ROWS.hours.bottom + 1}h10l-5,6z`} fill={C.today} />
          </g>

          {/* Hover */}
          {at != null && tip ? (
            <g aria-hidden="true" pointerEvents="none">
              <rect x={x0 + at * pph} width={pph} y={ROWS.hours.bottom} height={ROWS.spray.bottom - ROWS.hours.bottom} fill="oklch(0.3 0.03 160 / 0.07)" />
              <line x1={xc(at)} x2={xc(at)} y1={ROWS.hours.bottom} y2={ROWS.spray.bottom} stroke="oklch(0.3 0.03 160 / 0.45)" strokeDasharray="3 3" />
              {[
                { y: yT(tip.temp), c: rgb(paletteColor(PALETTES.temp, tip.temp)) },
                { y: yT(tip.feels), c: FEELS },
                { y: yT(tip.dew), c: DEW },
                { y: yW(tip.wind), c: rgb(paletteColor(PALETTES.wind, tip.wind)) },
                { y: yW(tip.gust), c: C.axis },
                { y: yH(tip.rh), c: HUMID },
              ].map((d, k) => (Number.isFinite(d.y) ? <circle key={k} cx={xc(at)} cy={d.y} r={3.5} fill={d.c} stroke="var(--card)" strokeWidth={1.5} /> : null))}
            </g>
          ) : null}
        </svg>
      </div>

      {tip && at != null ? (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            top: ROWS.temp.top,
            left: Math.min(Math.max(0, xc(at) - scrollX), (width || W) - 4),
            transform: tipRight ? "translateX(calc(-100% - 14px))" : "translateX(14px)",
          }}
        >
          <HourTooltip h={tip} tone={spray[at]} />
        </div>
      ) : null}
    </div>
  );
}

function fmtHour(ms: number) {
  return `${String(qatarHour(ms)).padStart(2, "0")}:00`;
}

function HourTooltip({ h, tone }: { h: PointHour; tone: ReturnType<typeof sprayForHour> }) {
  const bf = beaufort(h.wind);
  return (
    <TooltipShell title={hourLabel(h.time)}>
      <TooltipRow label="Temperature" value={`${fmtNum(h.temp, 1)} °C`} color={rgb(paletteColor(PALETTES.temp, h.temp))} />
      <TooltipRow label="Feels like" value={`${fmtNum(h.feels, 0)} °C`} color={FEELS} kind="dash" />
      <TooltipRow label="Dew point" value={`${fmtNum(h.dew, 0)} °C`} color={DEW} />
      <TooltipRow label="Rain" value={h.precip >= 0.05 ? `${fmtNum(h.precip, 1)} mm · ${fmtNum(h.precipProb, 0)}%` : `None · ${fmtNum(h.precipProb, 0)}% chance`} color={C.rain} kind="bar" />
      <TooltipRow label={`Wind ${compassPoint(h.windDir)}`} value={`${fmtNum(h.wind, 1)} m/s · ${fmtNum(kmh(h.wind), 0)} km/h`} color={rgb(paletteColor(PALETTES.wind, h.wind))} />
      <TooltipRow label="Gusts" value={`${fmtNum(h.gust, 1)} m/s`} color={C.axis} kind="dash" />
      <TooltipRow label="Humidity" value={`${fmtNum(h.rh, 0)}%`} color={HUMID} />
      <TooltipRow label="Cloud" value={`${fmtNum(h.cloud, 0)}%`} color={CLOUD} kind="band" muted />
      <TooltipRow label="Pressure" value={`${fmtNum(h.pressure, 0)} hPa`} muted />
      <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">
        <span className="font-semibold text-foreground">{bf.label}</span>
        {" · "}Spraying <span className="font-semibold text-foreground">{tone.label.toLowerCase()}</span>: {tone.reason}
      </div>
    </TooltipShell>
  );
}

/** The meteogram's key, for above the chart. */
export const METEOGRAM_LEGEND = [
  { kind: "line" as const, color: "oklch(0.64 0.17 50)", label: "Temperature (map colours)" },
  { kind: "dash" as const, color: FEELS, label: "Feels like" },
  { kind: "line" as const, color: DEW, label: "Dew point" },
  { kind: "bar" as const, color: C.rain, label: "Rain" },
  { kind: "dash" as const, color: C.rain, label: "Rain chance" },
  { kind: "band" as const, color: "oklch(0.6 0.12 250)", label: "Wind to gusts" },
  { kind: "line" as const, color: HUMID, label: "Humidity" },
];
