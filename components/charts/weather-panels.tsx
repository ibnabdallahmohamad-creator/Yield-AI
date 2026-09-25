"use client";

import { CloudOff, Droplets, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  AXIS_TICK,
  C,
  formatX,
  HatchDefs,
  Legend,
  MarginLabels,
  niceScale,
  rightMargin,
  tickFormatter,
  TooltipRow,
  TooltipShell,
  xTicks,
} from "@/components/charts/chart-kit";
import { ChartSummary, Headline, PanelFooter, Stat } from "@/components/charts/panel";
import type { PanelProps } from "@/components/charts/soil-panels";
import { Button } from "@/components/ui/button";
import { CROPS } from "@/lib/agronomy-tables";
import { weatherRows, type WeatherRow } from "@/lib/charts";
import { HEAT_STRESS_C } from "@/lib/crop-guides";
import { formatDay, formatShortDay, formatWeekday, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

function WeatherUnavailable({ what }: { what: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <CloudOff className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-semibold">Weather unavailable</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Open-Meteo can&apos;t be reached, so there is no {what} to show. The soil tabs are unaffected.
      </p>
      <Button variant="outline" size="sm" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
        <RotateCcw /> {pending ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}

const deg = (v: number | null | undefined) => (v == null ? "—" : `${fmtNum(v, 0)}°`);

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

export function TemperaturePanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const crop = CROPS[bundle.farm.main_crop];
  const heat = HEAT_STRESS_C[bundle.farm.main_crop];
  const rows = useMemo(() => weatherRows(bundle, dates, start, end), [bundle, dates, start, end]);
  const hasWeather = rows.some((r) => r.tmax != null);
  const scale = useMemo(
    () => niceScale(rows.flatMap((r) => [r.tmin, r.tmax, p.showSoil ? r.soil : null]), { minSpan: 15, atLeast: heat + 2 }),
    [rows, heat, p.showSoil],
  );
  if (!hasWeather) return <WeatherUnavailable what="air temperature" />;

  const today = dates[dates.length - 1];
  const viewDate = dates[end];
  const live = viewDate === today;
  const past = rows.filter((r) => !r.forecast);
  const future = rows.filter((r) => r.forecast);
  const todayRow = rows.find((r) => r.date === viewDate);
  const hotPast = past.filter((r) => r.tmax != null && r.tmax > heat).length;
  const hotNext = future.filter((r) => r.tmax != null && r.tmax > heat).length;
  const cropName = crop.name.toLowerCase();
  const sentence =
    hotPast + hotNext === 0
      ? `No heat stress for the ${cropName} in this period.`
      : `Days above ${heat} °C stress the ${cropName}${bundle.farm.main_crop === "alfalfa" ? " and slow its growth" : ": expect flower drop and poor fruit set"}. ${hotPast} of the last ${past.length} days${future.length ? `, and ${hotNext} of the next ${future.length}` : ""}.`;

  return (
    <div>
      <Headline
        value={`${deg(todayRow?.tmax)} / ${deg(todayRow?.tmin)}`}
        label={<span className="text-muted-foreground">{live ? "Today's high / low" : `High / low on ${formatShortDay(viewDate)}`}</span>}
        sentence={sentence}
      />
      <ChartSummary>
        Air temperature {live ? "today" : `on ${formatShortDay(viewDate)}`} {deg(todayRow?.tmax)} high, {deg(todayRow?.tmin)} low. {sentence}
      </ChartSummary>
      <div style={{ height: p.height }} role="img" aria-label={`Air temperature at ${bundle.farm.name}, last ${past.length} days and the ${future.length}-day forecast`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 16, right: rightMargin(p.narrow), bottom: 0, left: 0 }}>
            <HatchDefs id="hatch-temp" color={C.forecast} />
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="date" ticks={xTicks(rows.map((r) => r.date))} tickFormatter={formatX} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} height={28} />
            <YAxis domain={scale.domain} ticks={scale.ticks} allowDataOverflow width={36} tick={AXIS_TICK} tickFormatter={(v: number) => `${tickFormatter(0)(v)}°`} tickLine={false} axisLine={false} />
            <Area dataKey="band" stroke="none" fill={C.range} fillOpacity={0.3} isAnimationActive={false} connectNulls activeDot={false} />
            <Area dataKey="bandForecast" stroke="none" fill="url(#hatch-temp)" isAnimationActive={false} connectNulls activeDot={false} />
            <ReferenceLine y={heat} stroke={C.threshold} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />
            <ReferenceLine x={today} stroke={C.today} strokeWidth={1.25} label={{ value: "Today", position: "top", fontSize: 12, fontWeight: 600, fill: C.today }} />
            {p.showSoil ? <Line dataKey="soil" stroke={C.overlay} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} /> : null}
            <Line dataKey="meanPast" stroke={C.mean} strokeWidth={2.25} dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }} connectNulls animationDuration={300} />
            <Line dataKey="meanForecast" stroke={C.mean} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls isAnimationActive={false} />
            <MarginLabels labels={[{ y: heat, text: p.narrow ? `Heat ${heat}°` : `Heat stress ${heat}°`, tone: "threshold" }]} />
            <Tooltip
              cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
              content={(props) => {
                const t = props as TooltipContentProps<number, string>;
                const row = t.active ? (t.payload?.[0]?.payload as WeatherRow | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipShell title={`${formatDay(row.date)}${row.forecast ? " · forecast" : row.date === today ? " · today" : ""}`}>
                    <TooltipRow label="High / low" value={`${deg(row.tmax)} / ${deg(row.tmin)}`} color={C.range} kind="band" />
                    <TooltipRow label="Mean" value={row.tmean == null ? "—" : `${fmtNum(row.tmean, 1)} °C`} color={C.mean} />
                    {row.tmax != null && row.tmax > heat ? <TooltipRow label="Above the heat line" value={`+${fmtNum(row.tmax - heat, 0)}°`} muted /> : null}
                    {p.showSoil && row.soil != null ? <TooltipRow label="Soil (probes)" value={`${fmtNum(row.soil, 1)} °C`} color={C.overlay} kind="dash" /> : null}
                  </TooltipShell>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Daily mean" },
          { kind: "band", color: C.range, label: "Daily low–high" },
          { kind: "hatch", color: C.forecast, label: "Forecast" },
          { kind: "dash", color: C.threshold, label: `Heat stress for ${cropName} (indicative)` },
          ...(p.showSoil ? [{ kind: "dash" as const, color: C.overlay, label: "Soil temperature (probes, different source)" }] : []),
        ]}
      />
      <PanelFooter
        stats={
          <>
            <Stat label={`Days above ${heat}°`} value={`${hotPast} of ${past.length}`} />
            {future.length ? <Stat label={`Next ${future.length} days`} value={`${hotNext} hot day${hotNext === 1 ? "" : "s"}`} /> : null}
          </>
        }
        source="Open-Meteo · air at 2 m · same across the field"
        askHref={p.askHref(`How is the heat affecting the ${cropName} at ${bundle.farm.name}, and what can I do?`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------

function ForecastStrip({ rows }: { rows: WeatherRow[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Next {rows.length} days</p>
      <ol className="grid grid-cols-7 gap-1.5">
        {rows.map((r) => {
          const prob = r.rainProb ?? 0;
          return (
            <li key={r.date} className="flex flex-col items-center gap-1 rounded-lg bg-muted/60 px-1 py-2 text-center">
              <span className="text-xs font-semibold">{formatWeekday(r.date)}</span>
              <Droplets className={cn("size-4", prob >= 30 ? "text-[oklch(0.56_0.11_240)]" : "text-muted-foreground/60")} aria-hidden="true" />
              <span className="text-xs tabular text-muted-foreground">
                <span className="sr-only">Chance of rain </span>
                {fmtNum(prob, 0)}%
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RainPanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const rows = useMemo(() => weatherRows(bundle, dates, start, end), [bundle, dates, start, end]);
  const hasWeather = rows.some((r) => r.tmax != null || r.rain != null);
  const past = useMemo(() => rows.filter((r) => !r.forecast), [rows]);
  const future = rows.filter((r) => r.forecast);
  const total = past.reduce((a, r) => a + (r.rain ?? 0), 0);
  const nextTotal = future.reduce((a, r) => a + (r.rainForecast ?? 0), 0);
  const maxProb = Math.max(0, ...future.map((r) => r.rainProb ?? 0));
  const lastRain = [...past].reverse().find((r) => (r.rain ?? 0) >= 0.5);
  const etcTotal = [...past].reverse().find((r) => r.cumEtc != null)?.cumEtc ?? null;
  const today = dates[dates.length - 1];
  const dry = total < 0.5;
  const cropName = CROPS[bundle.farm.main_crop].name.toLowerCase();
  const barScale = useMemo(() => niceScale(rows.flatMap((r) => [r.rain, r.rainForecast]), { minSpan: 10, zero: true }), [rows]);
  const cumScale = useMemo(() => niceScale(past.flatMap((r) => [r.cumEtc, r.cumRain]), { minSpan: 50, zero: true }), [past]);

  if (!hasWeather) return <WeatherUnavailable what="rainfall" />;

  const sentence = dry
    ? `No rain in the last ${past.length} days. Irrigation is this farm's only water source.`
    : `${fmtNum(total, 0)} mm fell against ${fmtNum(etcTotal, 0)} mm of crop water use, so irrigation covered the rest.`;

  return (
    <div>
      <Headline
        value={fmtNum(total, total < 10 ? 1 : 0)}
        unit={`mm in ${past.length} days`}
        label={lastRain ? <span className="text-muted-foreground">Last rain {formatShortDay(lastRain.date)}</span> : undefined}
        sentence={sentence}
      />
      <ChartSummary>{sentence}</ChartSummary>
      {dry ? (
        <>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Crop water use vs rain, cumulative (mm)</p>
          <div style={{ height: Math.max(140, p.height - 70) }} role="img" aria-label={`Cumulative crop water use and rain at ${bundle.farm.name}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={past} margin={{ top: 8, right: rightMargin(p.narrow), bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="date" ticks={xTicks(past.map((r) => r.date))} tickFormatter={(d: string) => (d === today ? "Today" : formatX(d))} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} height={28} />
                <YAxis domain={cumScale.domain} ticks={cumScale.ticks} width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Line dataKey="cumEtc" stroke={C.mean} strokeWidth={2.25} dot={false} connectNulls animationDuration={300} />
                <Line dataKey="cumRain" stroke={C.rain} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <MarginLabels
                  labels={[
                    ...(etcTotal != null ? [{ y: etcTotal, text: `Crop ${fmtNum(etcTotal, 0)} mm`, tone: "muted" as const }] : []),
                    { y: 0, text: "Rain 0 mm", tone: "muted" as const },
                  ]}
                />
                <Tooltip
                  cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
                  content={(props) => {
                    const t = props as TooltipContentProps<number, string>;
                    const row = t.active ? (t.payload?.[0]?.payload as WeatherRow | undefined) : undefined;
                    if (!row) return null;
                    return (
                      <TooltipShell title={formatDay(row.date)}>
                        <TooltipRow label="Crop water use so far" value={`${fmtNum(row.cumEtc, 0)} mm`} color={C.mean} />
                        <TooltipRow label="Rain so far" value={`${fmtNum(row.cumRain, 0)} mm`} color={C.rain} />
                      </TooltipShell>
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend
            className="mt-2 mb-4"
            items={[
              { kind: "line", color: C.mean, label: `Crop water use (ETc), ${cropName}` },
              { kind: "line", color: C.rain, label: "Rain" },
            ]}
          />
          {future.length ? <ForecastStrip rows={future} /> : null}
        </>
      ) : (
        <>
          <div style={{ height: p.height }} role="img" aria-label={`Daily rain at ${bundle.farm.name}, last ${past.length} days and the forecast`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 18, right: rightMargin(p.narrow), bottom: 0, left: 0 }}>
                <HatchDefs id="hatch-rain" color={C.rain} />
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="date" ticks={xTicks(rows.map((r) => r.date))} tickFormatter={formatX} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} height={28} />
                <YAxis domain={barScale.domain} ticks={barScale.ticks} width={36} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <ReferenceLine x={today} stroke={C.today} strokeWidth={1.25} label={{ value: "Today", position: "top", fontSize: 12, fontWeight: 600, fill: C.today }} />
                <Bar dataKey="rain" fill={C.rain} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
                <Bar dataKey="rainForecast" fill="url(#hatch-rain)" stroke={C.rain} strokeOpacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.date} />
                  ))}
                  <LabelList dataKey="rainProb" position="top" fontSize={12} fill={C.axis} formatter={(v: unknown) => (typeof v === "number" && v >= 20 ? `${v}%` : "")} />
                </Bar>
                <Tooltip
                  cursor={{ fill: "oklch(0.3 0.02 120 / 0.06)" }}
                  content={(props) => {
                    const t = props as TooltipContentProps<number, string>;
                    const row = t.active ? (t.payload?.[0]?.payload as WeatherRow | undefined) : undefined;
                    if (!row) return null;
                    return (
                      <TooltipShell title={`${formatDay(row.date)}${row.forecast ? " · forecast" : ""}`}>
                        <TooltipRow label="Rain" value={`${fmtNum(row.forecast ? row.rainForecast : row.rain, 1)} mm`} color={C.rain} kind={row.forecast ? "hatch" : "bar"} />
                        {row.forecast && row.rainProb != null ? <TooltipRow label="Chance of rain" value={`${fmtNum(row.rainProb, 0)}%`} muted /> : null}
                      </TooltipShell>
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend
            className="mt-2"
            items={[
              { kind: "bar", color: C.rain, label: "Daily rain" },
              { kind: "hatch", color: C.rain, label: "Forecast (label = chance of rain)" },
            ]}
          />
        </>
      )}
      <PanelFooter
        stats={
          <>
            {future.length ? (
              <>
                <Stat label={`Next ${future.length} days`} value={`${fmtNum(nextTotal, nextTotal < 10 ? 1 : 0)} mm`} />
                <Stat label="Highest chance" value={`${fmtNum(maxProb, 0)}%`} />
              </>
            ) : (
              <Stat label="Rainy days" value={`${past.filter((r) => (r.rain ?? 0) >= 0.5).length} of ${past.length}`} />
            )}
          </>
        }
        source="Open-Meteo · same across the field"
        askHref={p.askHref(`With this rain outlook, how should I plan irrigation at ${bundle.farm.name} this week?`)}
      />
    </div>
  );
}
