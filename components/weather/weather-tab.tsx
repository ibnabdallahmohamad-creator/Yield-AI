"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Info,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { InfoTip } from "@/components/dashboard/info-tip";
import { Segmented } from "@/components/dashboard/segmented";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { WeatherMap, type WeatherMapFarm } from "@/components/weather";
import { useForecast } from "@/hooks/use-forecast";
import { useNow } from "@/hooks/use-now";
import { CROPS } from "@/lib/agronomy-tables";
import { lastDataIndex } from "@/lib/ai/analysis";
import { formatDay, qatarDay, relativeTime } from "@/lib/format";
import { colorFor, legendGradient } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  compass,
  gridRange,
  hourLabel,
  LEAF_WETNESS_RH,
  sliceSeries,
  SPRAY_WIND_MAX,
  summarizeOutlook,
  upcomingIndices,
  weatherAdvice,
  weatherCodeInfo,
  type AdviceLevel,
  type OutlookSummary,
  type WeatherAdvice,
  type WeatherIcon,
} from "@/lib/weather/analysis";
import { stretchedLayer, WEATHER_LAYERS, type WeatherLayer, type WeatherLayerKey } from "@/lib/weather/layers";
import type { ForecastBundle, HourlySeries, PointForecast } from "@/lib/weather/types";

export type WeatherView = "weather" | "temperature" | "humidity" | "rain" | "wind";

// Categorical slots 1–3 (validated all-pairs): blue, orange, aqua.
const C_BLUE = "#2a78d6";
const C_ORANGE = "#eb6834";
const C_AQUA = "#1baf7a";
const GRID_STROKE = "oklch(0.3 0.02 120 / 0.1)";
const AXIS_TICK = { fontSize: 11, fill: "oklch(0.47 0.025 115)" };
const SYNC_ID = "yai-weather";

const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const ICONS: Record<WeatherIcon, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

function WeatherGlyph({ code, night, className }: { code: number | null; night: boolean; className?: string }) {
  const { icon, label } = weatherCodeInfo(code);
  const Icon = night && icon === "clear" ? Moon : night && icon === "partly" ? CloudMoon : ICONS[icon];
  return <Icon className={className} aria-label={label} role="img" />;
}

function WindArrow({ from, className }: { from: number | null; className?: string }) {
  if (from == null) return <span className={className}>—</span>;
  return (
    <svg viewBox="0 0 24 24" className={cn("inline-block size-3.5", className)} style={{ transform: `rotate(${(from + 180) % 360}deg)` }} aria-label={`from ${compass(from)}`} role="img">
      <path d="M12 2 L18 12 L13.5 11 L13.5 22 L10.5 22 L10.5 11 L6 12 Z" fill="currentColor" />
    </svg>
  );
}

function StatTile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5 shadow-xs">
      <p className="truncate text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] leading-none font-semibold tracking-tight">{value}</span>
        {unit ? <span className="text-[12px] font-medium text-muted-foreground">{unit}</span> : null}
      </p>
      {sub ? <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

const ADVICE_STYLE: Record<AdviceLevel, { icon: LucideIcon; className: string }> = {
  alert: { icon: AlertTriangle, className: "border-risk-high/30 bg-risk-high-soft text-risk-high-ink" },
  warn: { icon: AlertTriangle, className: "border-risk-medium/40 bg-risk-medium-soft text-risk-medium-ink" },
  info: { icon: Info, className: "border-border bg-card text-foreground" },
  good: { icon: CheckCircle2, className: "border-risk-low/30 bg-risk-low-soft text-risk-low-ink" },
};

function AdviceList({ advice, empty }: { advice: WeatherAdvice[]; empty: string }) {
  if (advice.length === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {advice.map((a) => {
        const { icon: Icon, className } = ADVICE_STYLE[a.level];
        return (
          <li key={a.title} className={cn("flex gap-2.5 rounded-lg border px-3 py-2", className)}>
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">
                <span className="sr-only">{a.level === "alert" ? "Alert: " : a.level === "warn" ? "Warning: " : ""}</span>
                {a.title}
              </p>
              <p className="text-[12.5px] leading-snug opacity-90">{a.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Steps through the next 12 hours on the map. */
function HourSlider({ times, index, onChange }: { times: number[]; index: number; onChange: (i: number) => void }) {
  const [playing, setPlaying] = useState(false);
  const last = times.length - 1;
  const tick = useEffectEvent(() => {
    if (index >= last) {
      setPlaying(false);
      return;
    }
    onChange(index + 1);
  });
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => tick(), 700);
    return () => window.clearInterval(id);
  }, [playing]);
  if (times.length === 0) return null;
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 rounded-full border-primary/30 text-primary"
        aria-label={playing ? "Pause" : "Play the next 12 hours"}
        aria-pressed={playing}
        onClick={() => {
          if (!playing && index >= last) onChange(0);
          setPlaying((p) => !p);
        }}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </Button>
      <div className="min-w-0 flex-1 pt-1">
        <Slider
          min={0}
          max={last}
          step={1}
          value={[index]}
          onValueChange={([v]) => onChange(v)}
          thumbLabels={["Forecast hour"]}
          thumbValueText={[`${hourLabel(times[index])}, ${index === 0 ? "now" : `in ${index} hour${index === 1 ? "" : "s"}`}`]}
        />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular" aria-hidden="true">
          <span>Now</span>
          <span>{hourLabel(times[Math.round(last / 2)])}</span>
          <span>{hourLabel(times[last])}</span>
        </div>
      </div>
      <div className="w-24 shrink-0 text-right" aria-live="polite">
        <p className="text-sm font-semibold tabular">{hourLabel(times[index])}</p>
        <p className="text-xs text-muted-foreground">{index === 0 ? "now" : `+${index} h`}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

interface Row {
  t: number;
  label: string;
  temperature: number | null;
  apparent: number | null;
  dewPoint: number | null;
  humidity: number | null;
  vpd: number | null;
  precipitation: number | null;
  cumulative: number | null;
  precipProbability: number | null;
  windSpeed: number | null;
  windGusts: number | null;
  windDirection: number | null;
  et0: number | null;
}

function rowsFor(series: HourlySeries): Row[] {
  let total = 0;
  return series.time.map((t, i) => {
    total += series.precipitation[i] ?? 0;
    return {
      t,
      label: hourLabel(t),
      temperature: series.temperature[i],
      apparent: series.apparent[i],
      dewPoint: series.dewPoint[i],
      humidity: series.humidity[i],
      vpd: series.vpd[i],
      precipitation: series.precipitation[i],
      cumulative: Math.round(total * 10) / 10,
      precipProbability: series.precipProbability[i],
      windSpeed: series.windSpeed[i],
      windGusts: series.windGusts[i],
      windDirection: series.windDirection[i],
      et0: series.et0[i],
    };
  });
}

interface SeriesSpec {
  key: keyof Row;
  label: string;
  color: string;
  kind?: "line" | "bar";
  dashed?: boolean;
}

function ChartTooltip({ active, payload, specs, unit }: TooltipContentProps<number, string> & { specs: SeriesSpec[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  return (
    <div className="min-w-40 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 font-semibold">
        {formatDay(qatarDay(new Date(row.t).toISOString()))}, {row.label}
      </p>
      {specs.map((s) => (
        <p key={String(s.key)} className="flex items-center gap-2 tabular">
          <span className={cn("shrink-0 rounded-full", s.kind === "bar" ? "h-2.5 w-2 rounded-sm" : "h-0.5 w-3")} style={{ background: s.color }} />
          {s.label}
          <span className="ml-auto pl-3 font-semibold">
            {row[s.key] == null ? "—" : `${(row[s.key] as number).toLocaleString("en-US", { maximumFractionDigits: unit === "%" ? 0 : 1 })} ${unit}`}
          </span>
        </p>
      ))}
    </div>
  );
}

function LegendRow({ specs, extra }: { specs: SeriesSpec[]; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
      {specs.length > 1
        ? specs.map((s) => (
            <span key={String(s.key)} className="inline-flex items-center gap-1.5">
              {s.kind === "bar" ? (
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              ) : (
                <svg width="16" height="4" aria-hidden="true">
                  <line x1="0" y1="2" x2="16" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
                </svg>
              )}
              {s.label}
            </span>
          ))
        : null}
      {extra}
    </div>
  );
}

function HourChart({
  title,
  unit,
  rows,
  specs,
  domain,
  height = 190,
  refLine,
  refArea,
  info,
  footer,
}: {
  title: string;
  unit: string;
  rows: Row[];
  specs: SeriesSpec[];
  domain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  height?: number;
  refLine?: { y: number; label: string };
  refArea?: { y1: number; y2?: number; label: string };
  info?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const hasData = rows.some((r) => specs.some((s) => r[s.key] != null));
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-card p-3 shadow-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="text-[13.5px] font-semibold">
          {title} <span className="font-normal text-muted-foreground">· {unit}</span>
        </h4>
        {info ? <InfoTip label={`About ${title}`}>{info}</InfoTip> : null}
        <div className="ml-auto">
          <LegendRow
            specs={specs}
            extra={
              refLine ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg width="16" height="4" aria-hidden="true">
                    <line x1="0" y1="2" x2="16" y2="2" stroke="oklch(0.5 0.17 27)" strokeWidth="1.5" strokeDasharray="5 4" />
                  </svg>
                  {refLine.label}
                </span>
              ) : null
            }
          />
        </div>
      </div>
      {hasData ? (
        <div style={{ height }} role="img" aria-label={`${title} for the next ${rows.length} hours`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId={SYNC_ID} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "oklch(0.3 0.02 120 / 0.2)" }} interval="preserveStartEnd" minTickGap={14} />
              <YAxis domain={domain ?? ["auto", "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} allowDecimals />
              {refArea ? (
                <ReferenceArea
                  y1={refArea.y1}
                  y2={refArea.y2}
                  fill="oklch(0.56 0.19 27)"
                  fillOpacity={0.07}
                  stroke="none"
                  ifOverflow="hidden"
                  label={{ value: refArea.label, position: "insideTopLeft", fontSize: 10.5, fill: "oklch(0.46 0.17 27)" }}
                />
              ) : null}
              {refLine ? <ReferenceLine y={refLine.y} stroke="oklch(0.5 0.17 27)" strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" /> : null}
              {specs.map((s) =>
                s.kind === "bar" ? (
                  <Bar key={String(s.key)} dataKey={s.key} fill={s.color} maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                ) : (
                  <Line
                    key={String(s.key)}
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ),
              )}
              <Tooltip
                cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1, fill: "oklch(0.3 0.02 120 / 0.05)" }}
                content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} specs={specs} unit={unit} />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height }}>
          No forecast values.
        </div>
      )}
      {footer}
    </section>
  );
}

/** Where the wind comes from over the next hours: wedge length = hours, colour = mean speed. */
function WindRose({ series }: { series: HourlySeries }) {
  const sectors = Array.from({ length: 8 }, () => ({ hours: 0, speed: 0 }));
  series.windDirection.forEach((d, i) => {
    if (d == null) return;
    const s = Math.round((((d % 360) + 360) % 360) / 45) % 8;
    sectors[s].hours++;
    sectors[s].speed += series.windSpeed[i] ?? 0;
  });
  const max = Math.max(1, ...sectors.map((s) => s.hours));
  const size = 200;
  const c = size / 2;
  const rMax = c - 22;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const wedge = (i: number, r: number) => {
    const a0 = ((i * 45 - 20) * Math.PI) / 180;
    const a1 = ((i * 45 + 20) * Math.PI) / 180;
    const p = (a: number, rr: number) => `${c + rr * Math.sin(a)},${c - rr * Math.cos(a)}`;
    return `M${c},${c} L${p(a0, r)} A${r},${r} 0 0 1 ${p(a1, r)} Z`;
  };
  const summary = sectors
    .map((s, i) => (s.hours ? `${names[i]} ${s.hours} h at ${(s.speed / s.hours).toFixed(1)} m/s` : null))
    .filter(Boolean)
    .join(", ");
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[220px]" role="img" aria-label={`Wind rose: ${summary || "no wind data"}`}>
        {[0.33, 0.66, 1].map((k) => (
          <circle key={k} cx={c} cy={c} r={rMax * k} fill="none" stroke={GRID_STROKE} />
        ))}
        {sectors.map((s, i) =>
          s.hours > 0 ? (
            <path key={i} d={wedge(i, (rMax * s.hours) / max)} fill={colorFor(WEATHER_LAYERS.windSpeed, s.speed / s.hours)} stroke="var(--card)" strokeWidth={2}>
              <title>{`${names[i]}: ${s.hours} h, mean ${(s.speed / s.hours).toFixed(1)} m/s`}</title>
            </path>
          ) : null,
        )}
        {names.map((n, i) => {
          const a = (i * 45 * Math.PI) / 180;
          return (
            <text key={n} x={c + (rMax + 12) * Math.sin(a)} y={c - (rMax + 12) * Math.cos(a)} textAnchor="middle" dominantBaseline="middle" fontSize="10.5" fill="oklch(0.47 0.025 115)" fontWeight={n.length === 1 ? 600 : 400}>
              {n}
            </text>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-center text-[12px] text-muted-foreground">Wedge length: hours from that direction · colour: mean speed</figcaption>
    </figure>
  );
}

function HourlyTable({ series }: { series: HourlySeries }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] tabular">
        <caption className="sr-only">Hourly forecast for the next {series.time.length} hours</caption>
        <thead>
          <tr className="border-b text-left text-[11.5px] text-muted-foreground">
            <th className="py-2 pr-3 pl-3 font-medium">Time</th>
            <th className="py-2 pr-3 font-medium">Conditions</th>
            <th className="py-2 pr-3 text-right font-medium">Temp.</th>
            <th className="py-2 pr-3 text-right font-medium">Feels</th>
            <th className="py-2 pr-3 text-right font-medium">Humidity</th>
            <th className="py-2 pr-3 text-right font-medium">Rain</th>
            <th className="py-2 pr-3 text-right font-medium">Chance</th>
            <th className="py-2 pr-3 text-right font-medium">Wind</th>
            <th className="py-2 pr-3 text-right font-medium">Gusts</th>
            <th className="py-2 pr-3 text-right font-medium">ET₀</th>
          </tr>
        </thead>
        <tbody>
          {series.time.map((t, i) => (
            <tr key={t} className="border-b last:border-0">
              <td className="py-1.5 pr-3 pl-3 font-medium">{hourLabel(t)}</td>
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-1.5">
                  <WeatherGlyph code={series.weatherCode[i]} night={(series.radiation[i] ?? 1) === 0} className="size-4 text-muted-foreground" />
                  {weatherCodeInfo(series.weatherCode[i]).label}
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right font-semibold">{f1(series.temperature[i])} °C</td>
              <td className="py-1.5 pr-3 text-right">{f1(series.apparent[i])} °C</td>
              <td className="py-1.5 pr-3 text-right">{f0(series.humidity[i])} %</td>
              <td className="py-1.5 pr-3 text-right">{f1(series.precipitation[i])} mm</td>
              <td className="py-1.5 pr-3 text-right">{f0(series.precipProbability[i])} %</td>
              <td className="py-1.5 pr-3 text-right">
                <span className="inline-flex items-center gap-1">
                  <WindArrow from={series.windDirection[i]} className="text-muted-foreground" />
                  {f1(series.windSpeed[i])} m/s {compass(series.windDirection[i])}
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right">{f1(series.windGusts[i])} m/s</td>
              <td className="py-1.5 pr-3 text-right">{series.et0[i] == null ? "—" : `${series.et0[i]!.toFixed(2)} mm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Farm comparison
// ---------------------------------------------------------------------------

function FarmComparison({
  forecast,
  now,
  view,
  selectedId,
  onSelect,
}: {
  forecast: ForecastBundle;
  now: number;
  view: WeatherView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (forecast.points.length < 2) return null;
  const rows = forecast.points.map((p) => {
    const s = summarizeOutlook(sliceSeries(p.hourly, upcomingIndices(p.hourly, now)));
    return { p, s };
  });
  const cols: Array<{ label: string; value: (s: OutlookSummary, series: HourlySeries) => string }> =
    view === "temperature"
      ? [
          { label: "Max", value: (s) => `${f1(s.tempMax?.value)} °C` },
          { label: "at", value: (s) => (s.tempMax ? hourLabel(s.tempMax.time) : "—") },
          { label: "Min", value: (s) => `${f1(s.tempMin?.value)} °C` },
          { label: "ET₀ 12 h", value: (s) => `${f1(s.et0Total)} mm` },
        ]
      : view === "humidity"
        ? [
            { label: "Min RH", value: (s) => `${f0(s.humidityMin?.value)} %` },
            { label: "Max RH", value: (s) => `${f0(s.humidityMax?.value)} %` },
            { label: `≥ ${LEAF_WETNESS_RH}%`, value: (_s, series) => `${series.humidity.filter((v) => (v ?? 0) >= LEAF_WETNESS_RH).length} h` },
            { label: "Max VPD", value: (s) => `${f1(s.vpdMax?.value)} kPa` },
          ]
        : view === "rain"
          ? [
              { label: "Total", value: (s) => `${f1(s.rainTotal)} mm` },
              { label: "Rain hours", value: (s) => `${s.rainHours} h` },
              { label: "Max chance", value: (s) => `${f0(s.rainChanceMax?.value)} %` },
            ]
          : view === "wind"
            ? [
                { label: "Mean", value: (s) => `${f1(s.windMean)} m/s` },
                { label: "From", value: (s) => compass(s.windDirection) },
                { label: "Max gust", value: (s) => `${f1(s.gustMax?.value)} m/s` },
                { label: "at", value: (s) => (s.gustMax ? hourLabel(s.gustMax.time) : "—") },
              ]
            : [
                { label: "Conditions", value: (s) => weatherCodeInfo(s.dominantCode).label },
                { label: "Temp.", value: (s) => `${f0(s.tempMin?.value)}–${f0(s.tempMax?.value)} °C` },
                { label: "Rain", value: (s) => `${f1(s.rainTotal)} mm` },
                { label: "Max gust", value: (s) => `${f1(s.gustMax?.value)} m/s` },
              ];
  return (
    <section aria-labelledby="farm-compare" className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <h4 id="farm-compare" className="border-b px-3 py-2.5 text-[13.5px] font-semibold">
        Your farms, next 12 hours
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] tabular">
          <thead>
            <tr className="border-b text-left text-[11.5px] text-muted-foreground">
              <th className="py-2 pr-3 pl-3 font-medium">Farm</th>
              {cols.map((c) => (
                <th key={c.label} className="py-2 pr-3 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => {
              const series = sliceSeries(p.hourly, upcomingIndices(p.hourly, now));
              return (
                <tr key={p.id} className={cn("border-b last:border-0", p.id === selectedId && "bg-accent/50")}>
                  <td className="py-1.5 pr-3 pl-3">
                    <button type="button" className="font-medium hover:text-primary hover:underline" onClick={() => onSelect(p.id)}>
                      {p.name}
                    </button>
                  </td>
                  {cols.map((c) => (
                    <td key={c.label} className="py-1.5 pr-3 text-right">
                      {c.value(s, series)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

const VIEW_TITLE: Record<WeatherView, string> = {
  weather: "Weather",
  temperature: "Temperature",
  humidity: "Humidity",
  rain: "Rain",
  wind: "Wind",
};

const MAP_LAYERS: Record<WeatherView, WeatherLayerKey[]> = {
  weather: ["temperature", "precipitation", "humidity", "windSpeed"],
  temperature: ["temperature"],
  humidity: ["humidity"],
  rain: ["precipitation", "precipProbability"],
  wind: ["windSpeed", "windGusts"],
};

const ADVICE_TOPICS: Record<WeatherView, Array<WeatherAdvice["topic"]>> = {
  weather: ["rain", "heat", "cold", "wind", "humidity", "water"],
  temperature: ["heat", "cold", "water"],
  humidity: ["humidity", "heat"],
  rain: ["rain", "water"],
  wind: ["wind"],
};

export function WeatherTab({
  view,
  bundles,
  selectedFarmId,
  onSelectFarm,
  userKey,
}: {
  view: WeatherView;
  bundles: FarmBundle[];
  selectedFarmId: string;
  onSelectFarm: (id: string) => void;
  /** Keeps one account's forecast from showing to the next after switching accounts. */
  userKey: string;
}) {
  const { data, loading, reload } = useForecast(userKey);
  const clock = useNow();
  const [hourIndex, setHourIndex] = useState(0);
  const [layerChoice, setLayerChoice] = useState<Partial<Record<WeatherView, WeatherLayerKey>>>({});

  const forecast = data?.forecast ?? null;
  const now = clock ?? (forecast ? Date.parse(forecast.fetchedAt) : 0);
  const point: PointForecast | null = forecast?.points.find((p) => p.id === selectedFarmId) ?? forecast?.points[0] ?? null;
  const bundle = bundles.find((b) => b.farm.id === (point?.id ?? selectedFarmId));

  const series = useMemo(() => (point ? sliceSeries(point.hourly, upcomingIndices(point.hourly, now)) : null), [point, now]);
  const rows = useMemo(() => (series ? rowsFor(series) : []), [series]);
  const summary = useMemo(() => (series ? summarizeOutlook(series) : null), [series]);
  const kc = bundle ? (bundle.days[lastDataIndex(bundle)]?.kc ?? null) : null;
  const advice = useMemo(
    () => (series && bundle ? weatherAdvice(series, { name: CROPS[bundle.farm.main_crop].name, kc }) : []),
    [series, bundle, kc],
  );

  const layerKey = layerChoice[view] ?? MAP_LAYERS[view][0];
  // Temperature and humidity change little across a region: stretch their colours over the next
  // 12 hours' range so the map shows the pattern (rain and wind keep their meaningful classes).
  const layer: WeatherLayer = useMemo(() => {
    const base = WEATHER_LAYERS[layerKey];
    if (!base.stretch || !forecast?.grid || !series) return base;
    const hours = series.time.map((t) => forecast.grid!.time.indexOf(t)).filter((h) => h >= 0);
    const range = gridRange(forecast.grid, base.field, hours);
    return range ? stretchedLayer(base, range[0], range[1]) : base;
  }, [layerKey, forecast, series]);
  const hour = Math.min(hourIndex, Math.max(0, (series?.time.length ?? 1) - 1));
  const gridHour = forecast?.grid && series ? forecast.grid.time.indexOf(series.time[hour]) : -1;

  const mapFarms: WeatherMapFarm[] = useMemo(
    () =>
      bundles.map((b) => {
        const p = forecast?.points.find((x) => x.id === b.farm.id);
        const i = p && series ? p.hourly.time.indexOf(series.time[hour]) : -1;
        const value = p && i >= 0 ? (p.hourly[layer.field][i] ?? null) : null;
        return { id: b.farm.id, name: b.farm.name, polygon: b.farm.polygon, lat: b.farm.lat, lng: b.farm.lng, value };
      }),
    [bundles, forecast, series, hour, layer.field],
  );

  if (!forecast || !series || !summary) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card/60 p-6 text-center">
        {loading ? (
          <>
            <RefreshCw className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Loading the 12-hour forecast…</p>
          </>
        ) : (
          <>
            <Cloud className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-[15px] font-semibold">No forecast available</p>
            <p className="max-w-md text-[13px] text-muted-foreground">
              {data?.error ?? (bundles.length === 0 ? "Add a farm to get its forecast." : "The forecast couldn't be loaded.")}
            </p>
            <Button variant="outline" size="sm" onClick={() => void reload(true)}>
              <RefreshCw /> Try again
            </Button>
          </>
        )}
      </div>
    );
  }

  // The hour worth looking at on the map for this layer: wettest, hottest, most humid, windiest.
  const peak = (() => {
    const values = series[layer.field === "windDirection" ? "windSpeed" : layer.field];
    let index = -1;
    values.forEach((v, i) => {
      if (v != null && (index < 0 || v > (values[index] ?? -Infinity))) index = i;
    });
    if (index < 0 || (layer.key === "precipitation" && (values[index] ?? 0) < 0.1)) return null;
    const label = { temperature: "Hottest", humidity: "Most humid", precipitation: "Wettest", precipProbability: "Likeliest rain", windSpeed: "Windiest", windGusts: "Strongest gusts" }[
      layer.key
    ];
    return index === hour ? null : { index, label };
  })();

  const topics = ADVICE_TOPICS[view];
  const viewAdvice = advice.filter((a) => topics.includes(a.topic));
  const tempSpecs: SeriesSpec[] = [
    { key: "temperature", label: "Temperature", color: C_ORANGE },
    { key: "apparent", label: "Feels like", color: C_AQUA, dashed: true },
    { key: "dewPoint", label: "Dew point", color: C_BLUE },
  ];

  return (
    <div className="space-y-3">
      {/* Heading */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold">
          {VIEW_TITLE[view]} · next 12 hours at {point?.name}
        </h2>
        <span className="text-[12.5px] text-muted-foreground">
          {hourLabel(series.time[0])}–{hourLabel(series.time.at(-1)! + 3_600_000)} · updated {relativeTime(forecast.fetchedAt, now)} · refreshes every
          12 hours · Open-Meteo
        </span>
        {forecast.stale || data?.error ? (
          <span className="rounded-full bg-risk-medium-soft px-2 py-0.5 text-[11.5px] font-semibold text-risk-medium-ink">
            {data?.error ?? "Last available forecast"}
          </span>
        ) : null}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
        {view === "weather" ? (
          <>
            <StatTile label="Conditions" value={weatherCodeInfo(summary.dominantCode).label} sub={`${f0(summary.cloudMean)}% cloud cover`} />
            <StatTile label="Temperature" value={`${f0(summary.tempMin?.value)}–${f0(summary.tempMax?.value)}`} unit="°C" sub={summary.tempMax ? `Peak at ${hourLabel(summary.tempMax.time)}` : undefined} />
            <StatTile label="Humidity" value={`${f0(summary.humidityMin?.value)}–${f0(summary.humidityMax?.value)}`} unit="%" />
            <StatTile label="Rain" value={f1(summary.rainTotal)} unit="mm" sub={`Chance up to ${f0(summary.rainChanceMax?.value)}%`} />
            <StatTile label="Wind" value={f1(summary.windMean)} unit="m/s" sub={`From ${compass(summary.windDirection)} · gusts ${f1(summary.gustMax?.value)} m/s`} />
            <StatTile label="Reference ET₀" value={f1(summary.et0Total)} unit="mm" sub={kc != null ? `Crop use ≈ ${f1(summary.et0Total * kc)} mm` : "FAO-56, next 12 h"} />
          </>
        ) : view === "temperature" ? (
          <>
            <StatTile label="Maximum" value={f1(summary.tempMax?.value)} unit="°C" sub={summary.tempMax ? `at ${hourLabel(summary.tempMax.time)}` : undefined} />
            <StatTile label="Minimum" value={f1(summary.tempMin?.value)} unit="°C" sub={summary.tempMin ? `at ${hourLabel(summary.tempMin.time)}` : undefined} />
            <StatTile label="Feels like (max)" value={f1(Math.max(...series.apparent.filter((v): v is number => v != null)))} unit="°C" />
            <StatTile label="Hours ≥ 35 °C" value={String(series.temperature.filter((v) => (v ?? 0) >= 35).length)} unit="h" sub="Heat stress for most vegetables" />
            <StatTile label="Soil (probes)" value={f1(bundle?.days[lastDataIndex(bundle)]?.temperature)} unit="°C" sub="Latest daily mean" />
            <StatTile label="Reference ET₀" value={f1(summary.et0Total)} unit="mm" sub="Evaporative demand, 12 h" />
          </>
        ) : view === "humidity" ? (
          <>
            <StatTile label="Minimum" value={f0(summary.humidityMin?.value)} unit="%" sub={summary.humidityMin ? `at ${hourLabel(summary.humidityMin.time)}` : undefined} />
            <StatTile label="Maximum" value={f0(summary.humidityMax?.value)} unit="%" sub={summary.humidityMax ? `at ${hourLabel(summary.humidityMax.time)}` : undefined} />
            <StatTile label={`Hours ≥ ${LEAF_WETNESS_RH}%`} value={String(series.humidity.filter((v) => (v ?? 0) >= LEAF_WETNESS_RH).length)} unit="h" sub="Leaf-wetness risk" />
            <StatTile label="Max VPD" value={f1(summary.vpdMax?.value)} unit="kPa" sub={summary.vpdMax ? `at ${hourLabel(summary.vpdMax.time)}` : undefined} />
            <StatTile label="Dew point" value={`${f0(Math.min(...series.dewPoint.filter((v): v is number => v != null)))}–${f0(Math.max(...series.dewPoint.filter((v): v is number => v != null)))}`} unit="°C" />
            <StatTile label="Cloud cover" value={f0(summary.cloudMean)} unit="%" sub="Mean" />
          </>
        ) : view === "rain" ? (
          <>
            <StatTile label="Total" value={f1(summary.rainTotal)} unit="mm" sub="Next 12 hours" />
            <StatTile label="Rain hours" value={String(summary.rainHours)} unit="h" sub="≥ 0.1 mm" />
            <StatTile label="Max chance" value={f0(summary.rainChanceMax?.value)} unit="%" sub={summary.rainChanceMax ? `at ${hourLabel(summary.rainChanceMax.time)}` : undefined} />
            <StatTile label="Wettest hour" value={f1(Math.max(0, ...series.precipitation.filter((v): v is number => v != null)))} unit="mm" />
            <StatTile label="Crop water use" value={kc != null ? f1(summary.et0Total * kc) : f1(summary.et0Total)} unit="mm" sub={kc != null ? "ETc = Kc × ET₀, 12 h" : "ET₀, 12 h"} />
            <StatTile
              label="Rain vs crop use"
              value={kc != null && summary.et0Total > 0 ? `${f0(Math.min(100, (summary.rainTotal / (summary.et0Total * kc)) * 100))}` : "—"}
              unit="%"
              sub="Share of the crop's need"
            />
          </>
        ) : (
          <>
            <StatTile label="Mean speed" value={f1(summary.windMean)} unit="m/s" sub={`From ${compass(summary.windDirection)}`} />
            <StatTile label="Strongest gust" value={f1(summary.gustMax?.value)} unit="m/s" sub={summary.gustMax ? `at ${hourLabel(summary.gustMax.time)}` : undefined} />
            <StatTile label={`Calm hours (< ${SPRAY_WIND_MAX} m/s)`} value={String(series.windSpeed.filter((v) => (v ?? 99) < SPRAY_WIND_MAX).length)} unit="h" sub="Good for spraying" />
            <StatTile label="Max speed" value={f1(Math.max(0, ...series.windSpeed.filter((v): v is number => v != null)))} unit="m/s" />
            <StatTile label="Now" value={f1(series.windSpeed[0])} unit="m/s" sub={`From ${compass(series.windDirection[0])}`} />
            <StatTile label="Class now" value={series.windSpeed[0] == null ? "—" : (WEATHER_LAYERS.windSpeed.classes.find((c) => (series.windSpeed[0] ?? 0) < c.max)?.label ?? "—")} sub="Beaufort scale" />
          </>
        )}
      </div>

      {/* Map + advice */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label={`${layer.label} map`} className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <p className="text-[13px] font-semibold">{layer.label} map</p>
            <InfoTip label={`About the ${layer.label.toLowerCase()} map`}>
              {layer.description} Forecast points every few kilometres around your farms, blended smoothly between them.
            </InfoTip>
            {peak ? (
              <Button type="button" variant="ghost" size="sm" className="text-primary" onClick={() => setHourIndex(peak.index)}>
                {peak.label} {hourLabel(series.time[peak.index])}
              </Button>
            ) : null}
            {MAP_LAYERS[view].length > 1 ? (
              <Segmented
                ariaLabel="Map layer"
                size="sm"
                className="ml-auto"
                value={layerKey}
                onChange={(v) => setLayerChoice((c) => ({ ...c, [view]: v }))}
                options={MAP_LAYERS[view].map((k) => ({ value: k, label: WEATHER_LAYERS[k].short }))}
              />
            ) : null}
          </div>
          <div className="relative isolate h-[clamp(300px,50vh,460px)]">
            {forecast.grid && gridHour >= 0 ? (
              <WeatherMap
                grid={forecast.grid}
                layer={layer}
                hour={gridHour}
                farms={mapFarms}
                selectedId={point?.id ?? null}
                onSelect={onSelectFarm}
                showArrows={view === "wind" || (view === "weather" && layerKey === "windSpeed")}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">The regional map is unavailable for this forecast.</p>
            )}
          </div>
          <WeatherLegend layer={layer} />
          <div className="border-t px-3 py-3">
            <HourSlider times={series.time} index={hour} onChange={setHourIndex} />
          </div>
        </section>
        <section aria-labelledby="wx-advice" className="space-y-2 rounded-xl border bg-card p-3 shadow-xs">
          <h3 id="wx-advice" className="text-[13.5px] font-semibold">
            What it means for {point?.name}
          </h3>
          <AdviceList advice={viewAdvice} empty="Nothing that needs action in the next 12 hours." />
          {view === "wind" ? <WindRose series={series} /> : null}
        </section>
      </div>

      {/* Hourly strip (overview) */}
      {view === "weather" ? (
        <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12" aria-label="Hour by hour">
          {series.time.map((t, i) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => setHourIndex(i)}
                aria-pressed={i === hour}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-xl border bg-card px-1 py-2 text-[12px] transition-colors hover:border-primary/40",
                  i === hour && "border-primary/50 ring-1 ring-primary/30",
                )}
              >
                <span className="font-semibold tabular">{i === 0 ? "Now" : hourLabel(t)}</span>
                <WeatherGlyph code={series.weatherCode[i]} night={(series.radiation[i] ?? 1) === 0} className="size-5 text-foreground/70" />
                <span className="font-semibold tabular">{f0(series.temperature[i])}°</span>
                <span className="text-[11px] text-muted-foreground tabular">{f0(series.precipProbability[i])}%</span>
                <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular">
                  <WindArrow from={series.windDirection[i]} className="size-3" />
                  {f0(series.windSpeed[i])}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {/* Charts: one measure per chart, hours aligned and hover-synced */}
      <div className="grid gap-3 lg:grid-cols-2">
        {view === "weather" ? (
          <>
            <HourChart title="Temperature" unit="°C" rows={rows} specs={tempSpecs.slice(0, 2)} />
            <HourChart title="Rain" unit="mm" rows={rows} specs={[{ key: "precipitation", label: "Rain", color: C_BLUE, kind: "bar" }]} domain={[0, "auto"]} />
            <HourChart title="Wind" unit="m/s" rows={rows} specs={[{ key: "windSpeed", label: "Speed", color: C_BLUE }, { key: "windGusts", label: "Gusts", color: C_ORANGE }]} domain={[0, "auto"]} />
            <HourChart title="Relative humidity" unit="%" rows={rows} specs={[{ key: "humidity", label: "Humidity", color: C_BLUE }]} domain={[0, 100]} />
          </>
        ) : view === "temperature" ? (
          <>
            <HourChart
              title="Air temperature"
              unit="°C"
              rows={rows}
              specs={tempSpecs}
              refArea={{ y1: 35, label: "≥ 35 °C heat stress" }}
              height={240}
              info="Temperature at 2 m, the feels-like temperature (humidity and wind) and the dew point, where air would saturate."
            />
            <HourChart
              title="Reference evapotranspiration ET₀"
              unit="mm"
              rows={rows}
              specs={[{ key: "et0", label: "ET₀", color: C_AQUA, kind: "bar" }]}
              domain={[0, "auto"]}
              height={240}
              info="FAO-56 reference ET per hour from Open-Meteo: how hard the air pulls water out of the crop."
            />
          </>
        ) : view === "humidity" ? (
          <>
            <HourChart
              title="Relative humidity"
              unit="%"
              rows={rows}
              specs={[{ key: "humidity", label: "Humidity", color: C_BLUE }]}
              domain={[0, 100]}
              refLine={{ y: LEAF_WETNESS_RH, label: `${LEAF_WETNESS_RH}% leaf wetness` }}
              height={240}
            />
            <HourChart
              title="Vapour pressure deficit"
              unit="kPa"
              rows={rows}
              specs={[{ key: "vpd", label: "VPD", color: C_ORANGE }]}
              domain={[0, "auto"]}
              height={240}
              info="How dry the air is: the gap between the water vapour air could hold and what it holds. Higher VPD drives more transpiration."
            />
          </>
        ) : view === "rain" ? (
          <>
            <HourChart title="Rain per hour" unit="mm" rows={rows} specs={[{ key: "precipitation", label: "Rain", color: C_BLUE, kind: "bar" }]} domain={[0, "auto"]} height={220} />
            <HourChart title="Chance of rain" unit="%" rows={rows} specs={[{ key: "precipProbability", label: "Chance", color: C_BLUE }]} domain={[0, 100]} height={220} />
            <HourChart title="Accumulated rain" unit="mm" rows={rows} specs={[{ key: "cumulative", label: "Total so far", color: C_AQUA }]} domain={[0, "auto"]} height={220} />
            <HourChart title="Evaporative demand ET₀" unit="mm" rows={rows} specs={[{ key: "et0", label: "ET₀", color: C_ORANGE, kind: "bar" }]} domain={[0, "auto"]} height={220} />
          </>
        ) : (
          <>
            <HourChart
              title="Wind speed and gusts"
              unit="m/s"
              rows={rows}
              specs={[
                { key: "windSpeed", label: "Speed", color: C_BLUE },
                { key: "windGusts", label: "Gusts", color: C_ORANGE },
              ]}
              domain={[0, "auto"]}
              refLine={{ y: SPRAY_WIND_MAX, label: `Spray limit ${SPRAY_WIND_MAX} m/s` }}
              height={240}
              footer={
                <div className="mt-2 grid grid-flow-col gap-1 pl-9 text-center text-[10.5px] text-muted-foreground" aria-label="Wind direction by hour">
                  {series.windDirection.map((d, i) => (
                    <span key={i} className="flex flex-col items-center gap-0.5" title={`${hourLabel(series.time[i])}: from ${compass(d)}`}>
                      <WindArrow from={d} className="size-3.5 text-foreground/70" />
                      {compass(d)}
                    </span>
                  ))}
                </div>
              }
            />
            <FarmComparison forecast={forecast} now={now} view={view} selectedId={point?.id ?? null} onSelect={onSelectFarm} />
          </>
        )}
      </div>

      {view !== "wind" ? <FarmComparison forecast={forecast} now={now} view={view} selectedId={point?.id ?? null} onSelect={onSelectFarm} /> : null}

      {/* Table view of everything above */}
      <details className="group overflow-hidden rounded-xl border bg-card shadow-xs" open={view === "weather"}>
        <summary className="cursor-pointer list-none px-3 py-2.5 text-[13.5px] font-semibold marker:hidden">
          Hour-by-hour table <span className="font-normal text-muted-foreground">· {point?.name}</span>
        </summary>
        <div className="border-t">
          <HourlyTable series={series} />
        </div>
      </details>
    </div>
  );
}

function WeatherLegend({ layer }: { layer: WeatherLayer }) {
  if (layer.stretched) {
    // A continuous ramp with its boundary values underneath.
    const n = layer.classes.length;
    const ticks = layer.classes.slice(0, -1).map((c) => c.max);
    const f = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: layer.decimals === 0 ? 0 : 1 });
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2.5">
        <span className="text-[12px] font-semibold">
          {layer.label} <span className="font-normal text-muted-foreground">{layer.unit}</span>
        </span>
        <div className="min-w-60 flex-1 pt-1">
          <div
            className="h-2.5 rounded-full ring-1 ring-black/10 ring-inset"
            style={{ background: legendGradient(layer) }}
            role="img"
            aria-label={`${layer.label} colour scale from ${f(ticks[0])} to ${f(ticks[ticks.length - 1])} ${layer.unit}`}
          />
          <div className="relative mt-1 h-3.5 text-[10.5px] text-muted-foreground tabular" aria-hidden="true">
            {ticks.map((t, i) =>
              i % 2 === 0 || n <= 5 ? (
                <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((i + 1) / n) * 100}%` }}>
                  {f(t)}
                </span>
              ) : null,
            )}
          </div>
        </div>
        <span className="text-[11.5px] text-muted-foreground">Colours span the next 12 hours&apos; range</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2.5">
      <span className="text-[12px] font-semibold">
        {layer.label} <span className="font-normal text-muted-foreground">{layer.unit}</span>
      </span>
      <div className="flex min-w-60 flex-1 overflow-hidden rounded-md ring-1 ring-black/10" role="img" aria-label={`${layer.label} colour scale: ${layer.classes.map((c) => c.label).join(", ")}`}>
        {layer.classes.map((c) => (
          <span key={c.label} className="flex-1 truncate px-0.5 py-0.5 text-center text-[10.5px] font-medium tabular" style={{ background: c.color, color: colorIsDark(c.color) ? "#ffffff" : "#1c2320" }}>
            {c.label}
          </span>
        ))}
      </div>
      {layer.transparentBelow != null ? <span className="text-[11.5px] text-muted-foreground">Clear = below {layer.transparentBelow} {layer.unit}</span> : null}
    </div>
  );
}

function colorIsDark(hex: string): boolean {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
