"use client";

import { CloudOff, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
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
import type { FarmBundle } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CROPS } from "@/lib/agronomy-tables";
import { weatherRows, type WeatherRow } from "@/lib/charts";
import { HEAT_STRESS_C } from "@/lib/crop-guides";
import { formatDay, formatShortDay, fmtNum, plural } from "@/lib/format";

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
// Water balance (the "Water" tab)
// ---------------------------------------------------------------------------

/** Crop water use in amber-brown, so it never reads as the farm-mean green or the rain blue. */
const USE = "oklch(0.6 0.12 62)";
/** What irrigation had to supply: the gap between crop water use and rain. */
const GAP = "oklch(0.62 0.13 62 / 0.16)";

interface WaterRow {
  date: string;
  forecast: boolean;
  /** Daily crop water use (ETc, mm), drawn below zero; the forecast estimated from ET₀ × today's Kc. */
  useDown: number | null;
  useDownF: number | null;
  rainUp: number | null;
  rainUpF: number | null;
  rainProb: number | null;
  /** Cumulative since the start of the range, mm; the forecast continues them dashed. */
  cumUse: number | null;
  cumRain: number | null;
  cumUseF: number | null;
  cumRainF: number | null;
  gap: [number, number] | null;
  gapF: [number, number] | null;
}

/**
 * Running totals of crop water use (ETc) and rain. Days without ETc add nothing and are counted in
 * `missing`; until the first day with ETc the use totals stay empty rather than a made-up 0 mm.
 */
function waterRows(bundle: FarmBundle, rows: WeatherRow[], start: number): { rows: WaterRow[]; kc: number | null; missing: number } {
  const byDate = new Map(bundle.weatherDays.map((w) => [w.date, w]));
  // Today's crop coefficient, to turn the forecast reference ET₀ into crop water use.
  let kc: number | null = null;
  for (let i = bundle.days.length - 1; i >= 0 && kc == null; i--) {
    const d = bundle.days[i];
    if (d?.etc != null && d.et0 != null && d.et0 > 0) kc = d.etc / d.et0;
  }
  let use = 0;
  let rain = 0;
  let sawUse = false;
  let missing = 0;
  let lastPast = -1;
  const out = rows.map((r, k): WaterRow => {
    const day = r.forecast ? null : bundle.days[start + k];
    const w = byDate.get(r.date);
    const dayUse = r.forecast ? (w?.et0 != null && kc != null ? w.et0 * kc : null) : (day?.etc ?? null);
    const dayRain = r.forecast ? (r.rainForecast ?? 0) : (r.rain ?? 0);
    if (dayUse != null) {
      use += dayUse;
      sawUse = true;
    } else if (!r.forecast) missing++;
    rain += dayRain;
    if (!r.forecast) lastPast = k;
    const u = sawUse ? Math.round(use * 10) / 10 : null;
    // The band is irrigation's share: between rain and use, and only where use is ahead of rain.
    const gap: [number, number] | null = u != null ? [Math.min(rain, use), use] : null;
    return {
      date: r.date,
      forecast: r.forecast,
      useDown: !r.forecast && dayUse != null ? -dayUse : null,
      useDownF: r.forecast && dayUse != null ? -dayUse : null,
      rainUp: r.forecast ? null : dayRain,
      rainUpF: r.forecast ? dayRain : null,
      rainProb: r.rainProb,
      cumUse: r.forecast ? null : u,
      cumRain: r.forecast ? null : Math.round(rain * 10) / 10,
      cumUseF: r.forecast ? u : null,
      cumRainF: r.forecast ? Math.round(rain * 10) / 10 : null,
      gap: r.forecast ? null : gap,
      gapF: r.forecast ? gap : null,
    };
  });
  // The forecast lines start from today's totals so they join up.
  if (lastPast >= 0 && lastPast < out.length - 1) {
    const t = out[lastPast];
    out[lastPast] = { ...t, cumUseF: t.cumUse, cumRainF: t.cumRain, gapF: t.gap };
  }
  return { rows: out, kc, missing };
}

export function RainPanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const weather = useMemo(() => weatherRows(bundle, dates, start, end), [bundle, dates, start, end]);
  const hasWeather = weather.some((r) => r.tmax != null || r.rain != null);
  const { rows, missing } = useMemo(() => waterRows(bundle, weather, start), [bundle, weather, start]);
  const past = rows.filter((r) => !r.forecast);
  const future = rows.filter((r) => r.forecast);
  const lastPast = past[past.length - 1];
  const usedTotal = lastPast?.cumUse ?? null;
  const rainTotal = lastPast?.cumRain ?? 0;
  const irrigated = usedTotal != null ? Math.max(0, usedTotal - rainTotal) : null;
  const nextUse = future.reduce((a, r) => a + -(r.useDownF ?? 0), 0);
  const nextRain = future.reduce((a, r) => a + (r.rainUpF ?? 0), 0);
  const maxProb = Math.max(0, ...future.map((r) => r.rainProb ?? 0));
  const lastRain = [...weather].reverse().find((r) => !r.forecast && (r.rain ?? 0) >= 0.5);
  const today = dates[dates.length - 1];
  const cropName = CROPS[bundle.farm.main_crop].name.toLowerCase();

  const cumScale = useMemo(() => niceScale(rows.flatMap((r) => [r.cumUse, r.cumRain, r.cumUseF, r.cumRainF]), { minSpan: 20, zero: true }), [rows]);
  const dailyMax = Math.max(4, ...rows.flatMap((r) => [-(r.useDown ?? 0), -(r.useDownF ?? 0), r.rainUp ?? 0, r.rainUpF ?? 0]));
  const dailyStep = dailyMax <= 6 ? 2 : dailyMax <= 12 ? 4 : dailyMax <= 25 ? 10 : 20;
  const dailyTop = Math.ceil(dailyMax / dailyStep) * dailyStep;
  const syncId = `water-${bundle.farm.id}`;

  if (!hasWeather) return <WeatherUnavailable what="rainfall" />;

  const share = usedTotal != null && usedTotal > 0 && irrigated != null ? Math.round((irrigated / usedTotal) * 100) : null;
  const sentence =
    usedTotal == null
      ? `${fmtNum(rainTotal, 1)} mm of rain in the last ${past.length} days.`
      : rainTotal < 0.5
        ? `No rain in the last ${past.length} days: irrigation supplied all ${fmtNum(usedTotal, 0)} mm the ${cropName} used.`
        : `${fmtNum(rainTotal, rainTotal < 10 ? 1 : 0)} mm of rain against ${fmtNum(usedTotal, 0)} mm of crop water use, so irrigation supplied about ${share}%.`;
  const gaps = usedTotal != null && missing > 0 ? ` Crop water use is missing for ${plural(missing, "day")}, so the totals run low.` : "";
  const outlook = future.length ? ` Next ${future.length} days: the crop needs about ${fmtNum(nextUse, 0)} mm${nextRain >= 0.5 ? `, rain may bring ${fmtNum(nextRain, 1)} mm` : " and no rain is expected"}.` : "";
  const xs = xTicks(rows.map((r) => r.date));
  const xFormat = (d: string) => (d === today ? "Today" : formatX(d));

  return (
    <div>
      <Headline
        value={fmtNum(usedTotal, 0)}
        unit={`mm used in ${past.length} days`}
        label={<span className="text-muted-foreground">{`Rain ${fmtNum(rainTotal, rainTotal < 10 ? 1 : 0)} mm${lastRain ? `, last on ${formatShortDay(lastRain.date)}` : ""}`}</span>}
        sentence={sentence + gaps + outlook}
      />
      <ChartSummary>{sentence + gaps + outlook}</ChartSummary>

      <p className="mb-1 text-xs font-semibold text-muted-foreground">Running total, mm</p>
      <div style={{ height: Math.max(150, p.height - 96) }} role="img" aria-label={`Cumulative crop water use and rain at ${bundle.farm.name}. ${sentence}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: rightMargin(p.narrow), bottom: 8, left: 0 }} syncId={syncId}>
            <HatchDefs id="hatch-water" color={USE} />
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="date" ticks={xs} tickFormatter={xFormat} hide height={0} />
            <YAxis domain={cumScale.domain} ticks={cumScale.ticks} width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Area dataKey="gap" stroke="none" fill={GAP} fillOpacity={1} isAnimationActive={false} connectNulls activeDot={false} />
            <Area dataKey="gapF" stroke="none" fill="url(#hatch-water)" fillOpacity={0.6} isAnimationActive={false} connectNulls activeDot={false} />
            <ReferenceLine x={today} stroke={C.today} strokeWidth={1.25} label={{ value: "Today", position: "insideTopLeft", fontSize: 12, fontWeight: 600, fill: C.today }} />
            <Line dataKey="cumUse" stroke={USE} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls isAnimationActive={false} />
            <Line dataKey="cumUseF" stroke={USE} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="cumRain" stroke={C.rain} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls isAnimationActive={false} />
            <Line dataKey="cumRainF" stroke={C.rain} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            <MarginLabels
              labels={[
                ...(usedTotal != null ? [{ y: usedTotal, text: p.narrow ? `Used ${fmtNum(usedTotal, 0)}` : `Crop ${fmtNum(usedTotal, 0)} mm`, tone: "muted" as const }] : []),
                ...(usedTotal != null && irrigated != null && irrigated > 8
                  ? [{ y: rainTotal + irrigated / 2, text: p.narrow ? "Irrigation" : `Irrigation ${fmtNum(irrigated, 0)}`, tone: "muted" as const }]
                  : []),
                { y: rainTotal, text: p.narrow ? `Rain ${fmtNum(rainTotal, 0)}` : `Rain ${fmtNum(rainTotal, rainTotal < 10 ? 1 : 0)} mm`, tone: "muted" as const },
              ]}
            />
            <Tooltip
              cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
              wrapperStyle={{ zIndex: 20 }}
              content={(props) => <WaterTooltip {...(props as TooltipContentProps<number, string>)} />}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 mb-1 text-xs font-semibold text-muted-foreground">Each day, mm · rain up, crop use down</p>
      <div style={{ height: 96 }} role="img" aria-label={`Daily rain and crop water use at ${bundle.farm.name}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: rightMargin(p.narrow), bottom: 0, left: 0 }} stackOffset="sign" syncId={syncId}>
            <HatchDefs id="hatch-rain" color={C.rain} />
            <HatchDefs id="hatch-use" color={USE} />
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="date" ticks={xs} tickFormatter={xFormat} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} height={24} />
            <YAxis
              domain={[-dailyTop, dailyTop]}
              ticks={[-dailyTop, 0, dailyTop]}
              width={40}
              tick={AXIS_TICK}
              tickFormatter={(v: number) => tickFormatter(0)(Math.abs(v))}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine y={0} stroke={C.axis} strokeOpacity={0.4} />
            <ReferenceLine x={today} stroke={C.today} strokeWidth={1.25} />
            <Bar dataKey="rainUp" stackId="d" fill={C.rain} radius={[2, 2, 0, 0]} maxBarSize={12} isAnimationActive={false} />
            <Bar dataKey="useDown" stackId="d" fill={USE} fillOpacity={0.75} radius={[0, 0, 2, 2]} maxBarSize={12} isAnimationActive={false} />
            <Bar dataKey="rainUpF" stackId="d" fill="url(#hatch-rain)" stroke={C.rain} strokeOpacity={0.6} maxBarSize={12} isAnimationActive={false}>
              <LabelList dataKey="rainProb" position="top" fontSize={12} fill={C.axis} formatter={(v: unknown) => (typeof v === "number" && v >= 20 ? `${v}%` : "")} />
            </Bar>
            <Bar dataKey="useDownF" stackId="d" fill="url(#hatch-use)" stroke={USE} strokeOpacity={0.6} maxBarSize={12} isAnimationActive={false} />
            <MarginLabels labels={[{ y: dailyTop * 0.55, text: "Rain", tone: "muted" }, { y: -dailyTop * 0.55, text: p.narrow ? "Use" : "Crop use", tone: "muted" }]} />
            {/* The chart above shows the tooltip for both (synced); this one only marks the day. */}
            <Tooltip cursor={{ fill: "oklch(0.3 0.02 120 / 0.06)" }} content={() => null} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: USE, label: `Crop water use (ETc), ${cropName}` },
          { kind: "line", color: C.rain, label: "Rain" },
          { kind: "band", color: "oklch(0.62 0.13 62)", label: "Irrigation need (use − rain)" },
          ...(future.length ? [{ kind: "hatch" as const, color: USE, label: "Forecast (bar label = chance of rain)" }] : []),
        ]}
      />
      <PanelFooter
        stats={
          <>
            {share != null ? <Stat label="From irrigation" value={`${share}%`} /> : null}
            {future.length ? (
              <>
                <Stat label={`Crop needs, next ${future.length} days`} value={`${fmtNum(nextUse, 0)} mm`} />
                <Stat label="Highest rain chance" value={`${fmtNum(maxProb, 0)}%`} />
              </>
            ) : (
              <Stat label="Rainy days" value={`${past.filter((r) => (r.rainUp ?? 0) >= 0.5).length} of ${past.length}`} />
            )}
          </>
        }
        source="Open-Meteo rain and ET₀ · FAO-56 crop water use"
        askHref={p.askHref(`With this water balance and rain outlook, how should I plan irrigation at ${bundle.farm.name} this week?`)}
      />
    </div>
  );
}

function WaterTooltip(t: TooltipContentProps<number, string>) {
  const row = t.active ? (t.payload?.[0]?.payload as WaterRow | undefined) : undefined;
  if (!row) return null;
  const use = -(row.forecast ? (row.useDownF ?? NaN) : (row.useDown ?? NaN));
  const rain = row.forecast ? row.rainUpF : row.rainUp;
  const cumUse = row.forecast ? row.cumUseF : row.cumUse;
  const cumRain = row.forecast ? row.cumRainF : row.cumRain;
  return (
    <TooltipShell title={`${formatDay(row.date)}${row.forecast ? " · forecast" : ""}`}>
      <TooltipRow label={row.forecast ? "Crop use (estimate)" : "Crop use"} value={`${fmtNum(use, 1)} mm`} color={USE} kind={row.forecast ? "hatch" : "bar"} />
      <TooltipRow label="Rain" value={`${fmtNum(rain, 1)} mm${row.forecast && row.rainProb != null ? ` · ${fmtNum(row.rainProb, 0)}%` : ""}`} color={C.rain} kind={row.forecast ? "hatch" : "bar"} />
      {cumUse != null ? <TooltipRow label="Crop use so far" value={`${fmtNum(cumUse, 0)} mm`} muted /> : null}
      {cumUse != null && cumRain != null ? <TooltipRow label="From irrigation so far" value={`${fmtNum(Math.max(0, cumUse - cumRain), 0)} mm`} muted /> : null}
    </TooltipShell>
  );
}
