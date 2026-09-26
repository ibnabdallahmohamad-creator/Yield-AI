"use client";

import { useMemo, useState } from "react";
import {
  Area,
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
import {
  AXIS_TICK,
  C,
  formatX,
  Legend,
  MarginLabels,
  niceScale,
  rightMargin,
  tickFormatter,
  TooltipRow,
  TooltipShell,
  xTicks,
  type MarginLabel,
  type Scale,
} from "@/components/charts/chart-kit";
import { ChangeChip, ChartSummary, Headline, PanelFooter, Stat } from "@/components/charts/panel";
import { CROPS, ECE_CLASSES } from "@/lib/agronomy-tables";
import { extremeProbe, trend } from "@/lib/ai/analysis";
import { nutrientSummary, soilRows, triggerSeries, type SoilRow } from "@/lib/charts";
import { NUTRIENT_GUIDE, type NutrientKey } from "@/lib/crop-guides";
import { irrigationPlan, moistureLimitsPct, triggerMoisturePct, type ChartOverlay } from "@/lib/dashboard";
import { addDays } from "@/lib/data/time";
import { formatDay, fmtNum, plural } from "@/lib/format";
import { classFor, METRICS } from "@/lib/metrics";
import type { FarmBundle, FarmDay } from "@/lib/types";

export interface PanelProps {
  bundle: FarmBundle;
  dates: string[];
  start: number;
  end: number;
  height: number;
  compact: boolean;
  /** Day markers (e.g. the day being viewed on the map, or Then / Now). */
  markers: Array<{ index: number; label: string }>;
  overlay: ChartOverlay;
  overlayLabel: string | null;
  showProbes: boolean;
  showSoil: boolean;
  /** Phone width: shorter margin labels and a narrower margin. */
  narrow: boolean;
  askHref: (question: string) => string;
}

/** Distinct hues for "Show each probe", kept clear of the mean (green) and the limits (red). */
const PROBE_COLORS = ["#3f6fb0", "#d27a1f", "#8a5cb8", "#2f9a8f", "#a0664a", "#c4508a", "#7d8a2a", "#56708a"];

function probeColor(i: number): string {
  return PROBE_COLORS[i % PROBE_COLORS.length];
}

/** One legend entry per probe, in the chart's colours. */
function probeLegend(bundle: FarmBundle): Array<{ kind: "line"; color: string; label: string }> {
  return bundle.sensors.map((s, i) => ({ kind: "line", color: probeColor(i), label: s.id }));
}

export function latestIn(bundle: FarmBundle, start: number, end: number): { day: FarmDay; index: number } | null {
  for (let i = end; i >= start; i--) if (bundle.days[i]) return { day: bundle.days[i]!, index: i };
  return null;
}

function relChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || Math.abs(from) < 1e-9) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;

export type ChartRowX = SoilRow & {
  ref?: number | null;
  /** A shaded range between two series (e.g. the readily available water, trigger → field capacity). */
  zone?: [number, number] | null;
  /** Projected values after the last reading (dashed). */
  proj?: number | null;
  /** Yield at risk from salt that day, %. */
  loss?: number | null;
};

const yAxisWidth = (scale: Scale) => (scale.decimals > 0 ? 40 : 36);
/** Room for "100%" on the yield-at-risk strip; the salinity chart above takes the same width. */
const LOSS_AXIS = 46;

interface SoilChartProps {
  rows: ChartRowX[];
  dates: string[];
  end: number;
  scale: Scale;
  unit: string;
  decimals: number;
  height: number;
  ariaLabel: string;
  bands?: Array<{ y1: number; y2: number; color: string }>;
  threshold?: { y: number; label: string } | null;
  refLine?: { label: string } | null;
  marginLabels: MarginLabel[];
  markers: PanelProps["markers"];
  overlayLabel: string | null;
  probeIds: string[];
  showProbes: boolean;
  classOf?: (v: number) => string | null;
  syncId?: string;
  showXAxis?: boolean;
  narrow?: boolean;
  /** Fixed reference lines (field capacity, wilting point). */
  hlines?: Array<{ y: number; color: string }>;
  zone?: { color: string; label: string } | null;
  projection?: { label: string } | null;
  /** Vertical event markers after today (e.g. the next irrigation). */
  events?: Array<{ date: string; label: string }>;
  /** The last day with data, when rows run past it (projection). */
  lastDate?: string;
  /** False: this chart shows only the hover line (a synced chart shows the tooltip). */
  tooltip?: boolean;
  renderTooltip?: (row: ChartRowX) => React.ReactNode;
  /** Y-axis width, to line up with a chart stacked under this one. */
  yWidth?: number;
}

export function SoilChart({
  rows,
  dates,
  end,
  scale,
  unit,
  decimals,
  height,
  ariaLabel,
  bands = [],
  threshold,
  refLine,
  marginLabels,
  markers,
  overlayLabel,
  probeIds,
  showProbes,
  classOf,
  syncId,
  showXAxis = true,
  narrow = false,
  hlines = [],
  zone = null,
  projection = null,
  events = [],
  lastDate,
  tooltip = true,
  renderTooltip,
  yWidth,
}: SoilChartProps) {
  const today = dates[dates.length - 1];
  const first = rows.find((r) => r.value != null)?.value ?? null;
  const fmt = (v: number | null | undefined) => (v == null ? "—" : `${fmtNum(v, decimals)}${unit === "%" ? "%" : ` ${unit}`}`);
  const hasRange = rows.some((r) => r.range);
  const start = dates.indexOf(rows[0]?.date ?? "");

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: rightMargin(narrow), bottom: 0, left: 0 }} syncId={syncId}>
          {bands.map((b) => (
            <ReferenceArea key={`${b.y1}-${b.y2}`} y1={b.y1} y2={b.y2} fill={b.color} fillOpacity={0.12} stroke="none" ifOverflow="hidden" />
          ))}
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis
            dataKey="date"
            ticks={xAxisTicks(rows, lastDate)}
            tickFormatter={(d: string) => (d === (lastDate ?? today) ? "Today" : formatX(d))}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            hide={!showXAxis}
            height={showXAxis ? 28 : 0}
          />
          <YAxis
            domain={scale.domain}
            ticks={scale.ticks}
            allowDataOverflow
            width={yWidth ?? yAxisWidth(scale)}
            tick={AXIS_TICK}
            tickFormatter={tickFormatter(scale.decimals)}
            tickLine={false}
            axisLine={false}
          />
          {zone ? <Area dataKey="zone" stroke="none" fill={zone.color} fillOpacity={0.16} isAnimationActive={false} connectNulls activeDot={false} /> : null}
          {hlines.map((h) => (
            <ReferenceLine key={h.y} y={h.y} stroke={h.color} strokeWidth={1} strokeDasharray="2 3" ifOverflow="extendDomain" />
          ))}
          {hasRange && !showProbes ? (
            <Area dataKey="range" stroke="none" fill={C.range} fillOpacity={0.25} isAnimationActive={false} connectNulls activeDot={false} />
          ) : null}
          {showProbes
            ? probeIds.map((id, i) => (
                <Line
                  key={id}
                  dataKey={`p:${id}`}
                  stroke={probeColor(i)}
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            : null}
          {threshold ? <ReferenceLine y={threshold.y} stroke={C.threshold} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" /> : null}
          {refLine ? (
            <Line dataKey="ref" stroke={C.threshold} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
          ) : null}
          {overlayLabel ? <Line dataKey="overlay" stroke={C.overlay} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls animationDuration={300} /> : null}
          <Line
            dataKey="value"
            stroke={C.mean}
            strokeWidth={2.25}
            dot={rows.length <= 10 ? { r: 3, fill: C.mean, strokeWidth: 0 } : false}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }}
            connectNulls
            animationDuration={300}
          />
          {projection ? (
            <Line
              dataKey="proj"
              stroke={C.mean}
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeOpacity={0.75}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          {lastDate && lastDate !== rows[rows.length - 1]?.date ? <ReferenceLine x={lastDate} stroke={C.today} strokeWidth={1} strokeOpacity={0.5} /> : null}
          {events.map((e) => (
            <ReferenceLine
              key={e.date}
              x={e.date}
              stroke={C.rain}
              strokeWidth={1.5}
              label={{ value: e.label, position: "insideTopRight", fontSize: 12, fontWeight: 600, fill: C.rain }}
            />
          ))}
          {markers
            .filter((m) => m.index >= start && m.index <= end && m.index !== end)
            .map((m) => (
              <ReferenceLine
                key={`${m.label}-${m.index}`}
                x={dates[m.index]}
                stroke={C.today}
                strokeWidth={1.5}
                strokeDasharray={m.label === "Then" ? "3 3" : undefined}
                label={{ value: m.label, position: "insideTopRight", fontSize: 12, fontWeight: 600, fill: C.today }}
              />
            ))}
          <MarginLabels labels={marginLabels} />
          <Tooltip
            cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
            // Taller than a stacked strip: it must paint over the strips below it.
            wrapperStyle={{ zIndex: 20 }}
            content={(props) => {
              const p = props as TooltipContentProps<number, string>;
              if (!tooltip || !p.active || !p.payload?.length) return null;
              const row = p.payload[0]?.payload as ChartRowX | undefined;
              if (!row) return null;
              if (renderTooltip) return renderTooltip(row);
              const change = relChange(first, row.value);
              return (
                <TooltipShell title={formatDay(row.date)}>
                  {row.value == null && projection && row.proj != null ? (
                    <>
                      <TooltipRow label={projection.label} value={fmt(row.proj)} color={C.mean} kind="dash" />
                      {refLine && row.ref != null ? <TooltipRow label={refLine.label} value={fmt(row.ref)} color={C.threshold} kind="dash" muted /> : null}
                    </>
                  ) : row.value == null ? (
                    <p className="text-muted-foreground">No readings</p>
                  ) : (
                    <>
                      <TooltipRow label="Farm mean" value={fmt(row.value)} color={C.mean} />
                      {classOf && classOf(row.value) ? <TooltipRow label="Class" value={classOf(row.value) ?? ""} muted /> : null}
                      {row.loss != null ? <TooltipRow label="Yield at risk" value={`${fmtNum(row.loss, 0)}%`} color={C.threshold} kind="bar" muted={row.loss < 1} /> : null}
                      {showProbes ? <ProbeRows row={row} probeIds={probeIds} fmt={fmt} limit={threshold?.y ?? null} trigger={refLine ? (row.ref ?? null) : null} /> : null}
                      {row.range && !showProbes ? <TooltipRow label="Probe range" value={`${fmtNum(row.range[0], decimals)}–${fmtNum(row.range[1], decimals)}`} color={C.range} kind="band" muted /> : null}
                      {refLine && row.ref != null ? <TooltipRow label={refLine.label} value={fmt(row.ref)} color={C.threshold} kind="dash" muted /> : null}
                      {zone && row.zone ? <TooltipRow label={zone.label} value={`${fmtNum(row.zone[0], decimals)}–${fmtNum(row.zone[1], decimals)}`} color={zone.color} kind="band" muted /> : null}
                      {overlayLabel && row.overlay != null ? <TooltipRow label={overlayLabel} value={fmt(row.overlay)} color={C.overlay} kind="dash" /> : null}
                      {change != null && row.date !== rows[0]?.date ? <TooltipRow label="Since start of range" value={pct(change)} muted /> : null}
                    </>
                  )}
                </TooltipShell>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Each probe's value in the tooltip, highest first. Probes past the crop limit (or below the
 * irrigation trigger) are called out; when every probe is, one line says so instead.
 */
function ProbeRows({ row, probeIds, fmt, limit, trigger }: { row: ChartRowX; probeIds: string[]; fmt: (v: number) => string; limit: number | null; trigger: number | null }) {
  const probes = probeIds
    .map((id, i) => ({ id, i, v: row[`p:${id}`] }))
    .filter((x): x is { id: string; i: number; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v);
  const flagOf = (v: number) => (limit != null && v > limit ? "over limit" : trigger != null && v < trigger ? "needs water" : null);
  const flagged = probes.filter((x) => flagOf(x.v)).length;
  const all = flagged > 0 && flagged === probes.length;
  return (
    <>
      {all ? <TooltipRow label={`All ${probes.length} probes ${limit != null ? "over the limit" : "need water"}`} value="" muted /> : null}
      {probes.map((x) => {
        const flag = all ? null : flagOf(x.v);
        return <TooltipRow key={x.id} label={flag ? `${x.id} · ${flag}` : x.id} value={fmt(x.v)} color={probeColor(x.i)} muted={!flag && !all} />;
      })}
    </>
  );
}

/** Day ticks; with a projection, "Today" is always one, and the projection's end if it has room. */
function xAxisTicks(rows: ChartRowX[], lastDate: string | undefined): string[] {
  if (!lastDate) return xTicks(rows.map((r) => r.date));
  const past = xTicks(rows.filter((r) => r.date <= lastDate).map((r) => r.date), 4);
  const ahead = rows.length - 1 - rows.findIndex((r) => r.date === lastDate);
  return ahead >= Math.max(3, rows.length / 10) ? [...past, rows[rows.length - 1].date] : past;
}

function probeIdsOf(bundle: FarmBundle): string[] {
  return bundle.sensors.map((s) => s.id);
}

/**
 * Yield at risk from salt, day by day, under the salinity chart: what the readings above the crop
 * limit cost. Shares the hover with the chart above (whose tooltip shows the number).
 */
function LossStrip({ rows, dates, yWidth, syncId, narrow, height }: { rows: ChartRowX[]; dates: string[]; yWidth: number; syncId: string; narrow: boolean; height: number }) {
  const today = dates[dates.length - 1];
  const max = Math.max(0, ...rows.map((r) => r.loss ?? 0));
  const top = max <= 10 ? 10 : max <= 25 ? 25 : max <= 50 ? 50 : 100;
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: rightMargin(narrow), bottom: 0, left: 0 }} syncId={syncId} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis
            dataKey="date"
            ticks={xTicks(rows.map((r) => r.date))}
            tickFormatter={(d: string) => (d === today ? "Today" : formatX(d))}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            height={28}
          />
          <YAxis domain={[0, top]} ticks={[0, top]} allowDataOverflow width={yWidth} tick={AXIS_TICK} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} />
          <Area
            dataKey="loss"
            type="monotone"
            stroke={C.threshold}
            strokeWidth={1.5}
            fill={C.threshold}
            fillOpacity={0.2}
            connectNulls
            isAnimationActive={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)", fill: C.threshold }}
          />
          <MarginLabels labels={[{ y: top / 2, text: narrow ? "Yield lost" : "Yield at risk", tone: "threshold" }]} />
          <Tooltip cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }} content={() => null} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Salinity
// ---------------------------------------------------------------------------

const SHORT_CLASS: Record<string, string> = {
  "non-saline": "Non-saline",
  slightly: "Slight salt",
  moderately: "Moderate salt",
  strongly: "Strong salt",
  "very-strongly": "Very strong",
};
const NARROW_CLASS: Record<string, string> = {
  "non-saline": "None",
  slightly: "Slight",
  moderately: "Moderate",
  strongly: "Strong",
  "very-strongly": "Very strong",
};

export function SalinityPanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const crop = CROPS[bundle.farm.main_crop];
  const threshold = crop.salinity.threshold_dS_per_m;
  const rows = useMemo<ChartRowX[]>(
    () => soilRows(bundle, dates, start, end, (d) => d.ece, (s) => s.ece, p.overlay).map((r, i) => ({ ...r, loss: bundle.days[start + i]?.yieldLoss ?? null })),
    [bundle, dates, start, end, p.overlay],
  );
  // The strip only earns its space when salt has cost something in this window.
  const showLoss = rows.some((r) => (r.loss ?? 0) >= 0.5);
  const lossHeight = p.compact ? 72 : 88;
  const scale = useMemo(
    () => niceScale(rows.flatMap((r) => [r.value, r.range?.[1], r.overlay, ...(p.showProbes ? Object.entries(r).filter(([k]) => k.startsWith("p:")).map(([, v]) => v as number | null) : [])]), { minSpan: threshold * 1.5, zero: true, atLeast: threshold * 1.5 }),
    [rows, threshold, p.showProbes],
  );
  const latest = latestIn(bundle, start, end);
  const d = latest?.day ?? null;
  // Same window as the written advice and the compare badge: the day `range` days back to the latest.
  const t = trend(bundle, latest?.index ?? end, end - start + 1, (x) => x.ece);
  const change = t.changePct;
  const cls = d?.salinityClass ? ECE_CLASSES.find((c) => c.id === d.salinityClass)?.label : null;
  const loss = d?.yieldLoss ?? null;
  const saltiest = d && latest ? extremeProbe(bundle, d, (s) => s.ece, "max") : null;
  const days = t.days;
  const cropName = crop.name.toLowerCase();

  const sentence =
    d?.ece == null
      ? "No salinity readings in this period."
      : d.ece > threshold
        ? `Above the ${cropName}'s ${fmtNum(threshold, 1)} dS/m limit, so about ${fmtNum(loss, 0)}% of the yield is at risk.`
        : d.ece >= 0.85 * threshold
          ? `Just under the ${cropName}'s ${fmtNum(threshold, 1)} dS/m limit. No yield lost yet.`
          : `Well below the ${cropName}'s ${fmtNum(threshold, 1)} dS/m limit.`;

  const bands = METRICS.ece.classes.map((c) => ({ y1: c.min, y2: Math.min(c.max, scale.domain[1]), color: c.color })).filter((b) => b.y2 > b.y1 && b.y1 < scale.domain[1]);
  const marginLabels: MarginLabel[] = [
    ...METRICS.ece.classes
      .map((c, i) => ({ c, id: ECE_CLASSES[i].id }))
      .filter(({ c }) => c.min < scale.domain[1])
      .map(({ c, id }) => ({ y: (c.min + Math.min(c.max, scale.domain[1])) / 2, text: (p.narrow ? NARROW_CLASS : SHORT_CLASS)[id] ?? c.label, tone: "muted" as const })),
    { y: threshold, text: p.narrow ? "Limit" : `${crop.name} limit`, tone: "threshold" },
  ];

  return (
    <div>
      <Headline
        value={fmtNum(d?.ece, d?.ece != null && d.ece < 2 ? 2 : 1)}
        unit="dS/m"
        label={cls}
        change={change != null ? <ChangeChip value={change} text={`${pct(change)} in ${days} days`} risk={change >= 20 && (d?.ece ?? 0) > threshold} /> : null}
        sentence={sentence}
      />
      <ChartSummary>
        Salinity {fmtNum(d?.ece, 1)} dS/m, {cls ?? "no class"}. {sentence}
      </ChartSummary>
      <SoilChart
        rows={rows}
        dates={dates}
        end={end}
        scale={scale}
        unit="dS/m"
        decimals={1}
        ariaLabel={`Salinity (ECe) for ${bundle.farm.name}, last ${days} days`}
        bands={bands}
        threshold={{ y: threshold, label: `${crop.name} limit` }}
        marginLabels={marginLabels}
        markers={p.markers}
        overlayLabel={p.overlayLabel}
        probeIds={probeIdsOf(bundle)}
        showProbes={p.showProbes}
        classOf={(v) => classFor(METRICS.ece, v)?.label ?? null}
        narrow={p.narrow}
        height={showLoss ? p.height - 28 : p.height}
        showXAxis={!showLoss}
        yWidth={showLoss ? LOSS_AXIS : undefined}
        syncId={`salt-${bundle.farm.id}`}
      />
      {showLoss ? <LossStrip rows={rows} dates={dates} yWidth={LOSS_AXIS} syncId={`salt-${bundle.farm.id}`} narrow={p.narrow} height={lossHeight} /> : null}
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Farm mean" },
          ...(p.showProbes ? probeLegend(bundle) : [{ kind: "band" as const, color: C.range, label: "Probe range" }]),
          { kind: "dash", color: C.threshold, label: `${crop.name} limit ${fmtNum(threshold, 1)} dS/m` },
          ...(showLoss ? [{ kind: "band" as const, color: C.threshold, label: "Yield at risk (FAO-29)" }] : []),
          ...(p.overlayLabel ? [{ kind: "dash" as const, color: C.overlay, label: p.overlayLabel }] : []),
        ]}
      />
      <PanelFooter
        stats={
          <>
            <Stat label="Yield at risk" value={loss == null ? "—" : `${fmtNum(loss, 0)}%`} />
            <Stat label="Irrigation water" value={`${fmtNum(bundle.farm.irrigation_water_ec, 1)} dS/m`} />
            {saltiest ? <Stat label="Saltiest probe" value={`${saltiest.sensor.id} · ${fmtNum(saltiest.value, 1)} dS/m`} /> : null}
          </>
        }
        source={`${plural(bundle.sensors.length, "probe")} · daily means`}
        askHref={p.askHref(`Why is salinity ${change != null && change > 5 ? "rising" : "at this level"} at ${bundle.farm.name}, and what should I do about it?`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moisture
// ---------------------------------------------------------------------------

/** Days until the next irrigation, counted as `irrigationPlan` and the KPI tile count them. */
const irrigationOffset = (day: FarmDay) => (day.daysToIrrigation == null ? null : Math.round(Math.max(0, day.daysToIrrigation)));
/** How far ahead the moisture chart projects. */
const PROJECT_DAYS = 10;

/**
 * The days after the last reading: moisture falls by the crop's water use (ETc spread over the root
 * zone) until it reaches the irrigation trigger, the day the plan says to irrigate.
 */
function dryDown(bundle: FarmBundle, day: FarmDay, date: string): Array<{ date: string; proj: number; ref: number | null }> {
  if (day.moisture == null || day.etc == null || !(day.rootDepth > 0) || day.daysToIrrigation == null) return [];
  const perDay = (day.etc / (1000 * day.rootDepth)) * 100;
  const ref = triggerMoisturePct(bundle.farm, day);
  const until = Math.min(PROJECT_DAYS, irrigationOffset(day) ?? 0);
  const out: Array<{ date: string; proj: number; ref: number | null }> = [];
  for (let k = 1; k <= until; k++) out.push({ date: addDays(date, k), proj: Math.max(0, day.moisture - perDay * Math.min(k, day.daysToIrrigation)), ref });
  return out;
}

/** Moisture rows with the irrigation trigger, the easy-water zone and (from today) the projected dry-down. */
function moistureRows(bundle: FarmBundle, dates: string[], start: number, end: number, overlay: ChartOverlay, fc: number, fromIndex: number): ChartRowX[] {
  const base = soilRows(bundle, dates, start, end, (x) => x.moisture, (s) => s.moisture, overlay);
  const trigger = triggerSeries(bundle, start, end);
  const past: ChartRowX[] = base.map((r, i) => ({ ...r, ref: trigger[i], zone: trigger[i] != null ? [trigger[i]!, fc] : null }));
  const from = fromIndex >= 0 ? bundle.days[fromIndex] : null;
  if (!from) return past;
  const last = past.findLastIndex((r) => r.value != null);
  if (last >= 0) past[last] = { ...past[last], proj: past[last].value };
  const future: ChartRowX[] = dryDown(bundle, from, dates[fromIndex]).map((f) => ({
    date: f.date,
    value: null,
    range: null,
    overlay: null,
    ref: f.ref,
    zone: f.ref != null ? [f.ref, fc] : null,
    proj: f.proj,
  }));
  return [...past, ...future];
}

export function MoisturePanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const limits = moistureLimitsPct(bundle.farm);
  const fc = limits.fc;
  const wp = limits.wp;
  // Only project from today's reading, not when the window ends in the past.
  const lastIndex = latestIn(bundle, start, end)?.index ?? -1;
  const fromIndex = lastIndex === dates.length - 1 ? lastIndex : -1;
  const rows = useMemo(() => moistureRows(bundle, dates, start, end, p.overlay, fc, fromIndex), [bundle, dates, start, end, p.overlay, fc, fromIndex]);
  const latest = latestIn(bundle, start, end);
  const d = latest?.day ?? null;
  const projecting = fromIndex >= 0;
  const scale = useMemo(
    () => niceScale(rows.flatMap((r) => [r.value, r.range?.[0], r.range?.[1], r.ref, r.overlay, r.proj, fc, wp]), { minSpan: 20, zero: true }),
    [rows, fc, wp],
  );
  const t = trend(bundle, latest?.index ?? end, end - start + 1, (x) => x.moisture);
  const change = t.changePct;
  const plan = irrigationPlan(d, dates, latest?.index ?? end);
  const deficitClass = d?.deficitPct != null ? classFor(METRICS.deficit, d.deficitPct)?.label : null;
  const days = t.days;
  const stressed = (d?.deficitPct ?? 0) > 100;
  const lastRef = [...rows].reverse().find((r) => r.ref != null)?.ref ?? null;
  // Due today puts the marker on the Today line; beyond the projection there is no marker (the headline has the day).
  const offset = d ? irrigationOffset(d) : null;
  const irrigateDate = projecting && latest && offset != null && offset <= PROJECT_DAYS && plan.grossMm != null ? addDays(dates[latest.index], offset) : null;
  const moistureLabels: MarginLabel[] = [
    { y: limits.fc, text: p.narrow ? "Full" : "Field capacity", tone: "adequate" },
    { y: limits.wp, text: p.narrow ? "Wilting" : "Wilting point", tone: "threshold" },
    ...(lastRef != null ? [{ y: lastRef, text: p.narrow ? "Irrigate" : "Irrigate below", tone: "threshold" as const }] : []),
    ...(lastRef != null ? [{ y: (lastRef + limits.fc) / 2, text: p.narrow ? "Easy" : "Easy to take up", tone: "muted" as const }] : []),
  ];

  return (
    <div>
      <Headline
        value={fmtNum(d?.moisture, 1)}
        unit="% VWC"
        label={deficitClass}
        change={change != null ? <ChangeChip value={change} text={`${pct(change)} in ${days} days`} risk={change <= -20 && stressed} /> : null}
        sentence={stressed ? `The crop is short of water now. ${plan.sentence}` : plan.sentence}
      />
      <ChartSummary>
        Soil moisture {fmtNum(d?.moisture, 1)}%. {plan.sentence}
      </ChartSummary>
      <SoilChart
        rows={rows}
        dates={dates}
        end={end}
        scale={scale}
        unit="%"
        decimals={1}
        height={p.height}
        ariaLabel={`Soil moisture for ${bundle.farm.name}, last ${days} days`}
        refLine={{ label: "Irrigate below" }}
        marginLabels={moistureLabels}
        narrow={p.narrow}
        hlines={[
          { y: limits.fc, color: C.adequate },
          { y: limits.wp, color: C.threshold },
        ]}
        zone={{ color: C.adequate, label: "Readily available water" }}
        projection={projecting ? { label: "Projected (crop water use)" } : null}
        events={irrigateDate ? [{ date: irrigateDate, label: `Irrigate ${plan.grossMm} mm` }] : []}
        lastDate={projecting && latest ? dates[latest.index] : undefined}
        markers={p.markers}
        overlayLabel={p.overlayLabel}
        probeIds={probeIdsOf(bundle)}
        showProbes={p.showProbes}
      />
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Farm mean" },
          ...(p.showProbes ? probeLegend(bundle) : [{ kind: "band" as const, color: C.range, label: "Probe range" }]),
          { kind: "band", color: C.adequate, label: "Readily available water" },
          { kind: "dash", color: C.threshold, label: "Irrigation trigger" },
          ...(projecting ? [{ kind: "dash" as const, color: C.mean, label: "Projected until irrigation" }] : []),
          ...(p.overlayLabel ? [{ kind: "dash" as const, color: C.overlay, label: p.overlayLabel }] : []),
        ]}
      />
      <PanelFooter
        stats={
          <>
            <Stat label="Next irrigation" value={plan.grossMm != null ? `${plan.when} · ${plan.grossMm} mm` : "—"} />
            <Stat label="Water used" value={d?.deficitPct != null ? `${fmtNum(d.deficitPct, 0)}% of reserve` : "—"} />
            {!p.compact ? <Stat label="Crop water use" value={d?.etc != null ? `${fmtNum(d.etc, 1)} mm/day` : "—"} /> : null}
          </>
        }
        source={`${plural(bundle.sensors.length, "probe")} · FAO-56 water balance`}
        askHref={p.askHref(`How much should I irrigate ${bundle.farm.name}, and when?`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NPK
// ---------------------------------------------------------------------------

const STATUS_WORD = { low: "Low", adequate: "Adequate", ample: "Above range" } as const;

function NutrientStrip({
  bundle,
  dates,
  start,
  end,
  k,
  height,
  showXAxis,
  markers,
  narrow,
  tooltip,
  renderTooltip,
  onHover,
}: {
  bundle: FarmBundle;
  dates: string[];
  start: number;
  end: number;
  k: NutrientKey;
  height: number;
  showXAxis: boolean;
  markers: PanelProps["markers"];
  narrow: boolean;
  tooltip: boolean;
  renderTooltip: (row: ChartRowX) => React.ReactNode;
  onHover: (k: NutrientKey) => void;
}) {
  const g = NUTRIENT_GUIDE[k];
  const rows = useMemo(() => soilRows(bundle, dates, start, end, (d) => d[k], (s) => s[k]), [bundle, dates, start, end, k]);
  const scale = useMemo(() => niceScale(rows.flatMap((r) => [r.value, r.range?.[1]]), { minSpan: g.chartMax, zero: true, atLeast: g.chartMax }), [rows, g.chartMax]);
  const latest = latestIn(bundle, start, end)?.day ?? null;
  const summary = nutrientSummary(latest).find((s) => s.key === k);
  return (
    <div onPointerEnter={() => onHover(k)} onFocus={() => onHover(k)}>
      <p className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold">{g.label}</span>
        <span className="tabular">{fmtNum(summary?.value, 0)} mg/kg</span>
        {summary?.status ? (
          <span className={summary.status === "low" ? "font-medium text-risk-medium-ink" : "text-muted-foreground"}>{STATUS_WORD[summary.status]}</span>
        ) : null}
      </p>
      <SoilChart
        rows={rows}
        dates={dates}
        end={end}
        scale={scale}
        unit="mg/kg"
        decimals={0}
        height={height + (showXAxis ? 28 : 0)}
        ariaLabel={`${g.label} for ${bundle.farm.name}, last ${end - start + 1} days`}
        bands={[{ y1: g.low, y2: g.high, color: C.adequate }]}
        marginLabels={[{ y: (g.low + g.high) / 2, text: "Adequate", tone: "adequate" }]}
        markers={markers}
        overlayLabel={null}
        probeIds={[]}
        showProbes={false}
        syncId={`npk-${bundle.farm.id}`}
        showXAxis={showXAxis}
        narrow={narrow}
        tooltip={tooltip}
        renderTooltip={renderTooltip}
      />
    </div>
  );
}

export function NpkPanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const latest = latestIn(bundle, start, end)?.day ?? null;
  const summary = nutrientSummary(latest);
  const weakest = summary[0];
  const low = summary.filter((s) => s.status === "low");
  const phClass = latest?.ph != null ? classFor(METRICS.ph, latest.ph)?.label : null;
  const stripHeight = p.compact ? 72 : 104;
  const g = weakest ? NUTRIENT_GUIDE[weakest.key] : null;
  // The three strips share a hover line; only the one under the pointer shows the (combined) tooltip.
  const [hover, setHover] = useState<NutrientKey>("n");
  const npkTooltip = (row: ChartRowX) => {
    const i = dates.indexOf(row.date);
    const day = i >= 0 ? bundle.days[i] : null;
    return (
      <TooltipShell title={formatDay(row.date)}>
        {!day ? (
          <p className="text-muted-foreground">No readings</p>
        ) : (
          <>
            {(["n", "p", "k"] as NutrientKey[]).map((k) => {
              const guide = NUTRIENT_GUIDE[k];
              const v = day[k];
              const status = v == null ? null : v < guide.low ? "low" : v > guide.high ? "above range" : null;
              return (
                <TooltipRow
                  key={k}
                  label={status ? `${guide.label} · ${status}` : guide.label}
                  value={v == null ? "—" : `${fmtNum(v, 0)} mg/kg`}
                  color={k === hover ? C.mean : undefined}
                  muted={k !== hover && status !== "low"}
                />
              );
            })}
            <TooltipRow label="Soil pH" value={fmtNum(day.ph, 2)} muted />
          </>
        )}
      </TooltipShell>
    );
  };

  return (
    <div>
      <Headline
        value={weakest && g ? `${weakest.key.toUpperCase()} ${fmtNum(weakest.value, 0)}` : "—"}
        unit="mg/kg"
        label={weakest?.status ? `Lowest vs target · ${STATUS_WORD[weakest.status].toLowerCase()}` : undefined}
        sentence={
          low.length > 0
            ? `${low.map((s) => NUTRIENT_GUIDE[s.key].label).join(" and ")} ${low.length > 1 ? "are" : "is"} below the indicative range. Plan a top-up in the next fertigation.`
            : "All three nutrients are within or above the indicative range."
        }
      />
      <div className="space-y-2">
        {(["n", "p", "k"] as NutrientKey[]).map((k, i) => (
          <NutrientStrip
            key={k}
            bundle={bundle}
            dates={dates}
            start={start}
            end={end}
            k={k}
            height={stripHeight}
            showXAxis={i === 2}
            markers={p.markers}
            narrow={p.narrow}
            tooltip={hover === k}
            renderTooltip={npkTooltip}
            onHover={setHover}
          />
        ))}
      </div>
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Farm mean" },
          { kind: "band", color: C.range, label: "Probe range" },
          { kind: "band", color: C.adequate, label: "Indicative adequate range" },
        ]}
      />
      <PanelFooter
        stats={
          <Stat
            label="Soil pH"
            value={latest?.ph != null ? `${fmtNum(latest.ph, 2)}${phClass ? ` · ${phClass.toLowerCase()}` : ""}${latest.ph > 8 ? " (limits P uptake)" : ""}` : "—"}
          />
        }
        source="Probes · indicative ranges, not crop-specific"
        askHref={p.askHref(`Are the nutrient levels at ${bundle.farm.name} enough for the crop? What should I fertilise?`)}
      />
    </div>
  );
}

