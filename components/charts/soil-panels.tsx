"use client";

import { useMemo } from "react";
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
import { irrigationPlan, type ChartOverlay } from "@/lib/dashboard";
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

const PROBE_COLORS = ["#6b8f71", "#8a7f5a", "#5f7f95", "#8d6b80", "#7a8a4f", "#5c8a86", "#9a6f5a", "#6f6f9a"];

function latestIn(bundle: FarmBundle, start: number, end: number): { day: FarmDay; index: number } | null {
  for (let i = end; i >= start; i--) if (bundle.days[i]) return { day: bundle.days[i]!, index: i };
  return null;
}

function relChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || Math.abs(from) < 1e-9) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;

interface SoilChartProps {
  rows: Array<SoilRow & { ref?: number | null }>;
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
}

function SoilChart({
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
            ticks={xTicks(rows.map((r) => r.date))}
            tickFormatter={(d: string) => (d === today ? "Today" : formatX(d))}
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
            width={scale.decimals > 0 ? 40 : 36}
            tick={AXIS_TICK}
            tickFormatter={tickFormatter(scale.decimals)}
            tickLine={false}
            axisLine={false}
          />
          {hasRange && !showProbes ? (
            <Area dataKey="range" stroke="none" fill={C.range} fillOpacity={0.25} isAnimationActive={false} connectNulls activeDot={false} />
          ) : null}
          {showProbes
            ? probeIds.map((id, i) => (
                <Line
                  key={id}
                  dataKey={`p:${id}`}
                  stroke={PROBE_COLORS[i % PROBE_COLORS.length]}
                  strokeWidth={1.25}
                  strokeOpacity={0.8}
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
            content={(props) => {
              const p = props as TooltipContentProps<number, string>;
              if (!p.active || !p.payload?.length) return null;
              const row = p.payload[0]?.payload as (SoilRow & { ref?: number | null }) | undefined;
              if (!row) return null;
              const change = relChange(first, row.value);
              return (
                <TooltipShell title={formatDay(row.date)}>
                  {row.value == null ? (
                    <p className="text-muted-foreground">No readings</p>
                  ) : (
                    <>
                      <TooltipRow label="Farm mean" value={fmt(row.value)} color={C.mean} />
                      {classOf && classOf(row.value) ? <TooltipRow label="Class" value={classOf(row.value) ?? ""} muted /> : null}
                      {row.range ? <TooltipRow label="Probe range" value={`${fmtNum(row.range[0], decimals)}–${fmtNum(row.range[1], decimals)}`} color={C.range} kind="band" muted /> : null}
                      {refLine && row.ref != null ? <TooltipRow label={refLine.label} value={fmt(row.ref)} color={C.threshold} kind="dash" muted /> : null}
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

function probeIdsOf(bundle: FarmBundle): string[] {
  return bundle.sensors.map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Salinity
// ---------------------------------------------------------------------------

const SHORT_CLASS: Record<string, string> = {
  "non-saline": "Non-saline",
  slightly: "Slightly saline",
  moderately: "Moderately",
  strongly: "Strongly",
  "very-strongly": "Very strongly",
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
  const rows = useMemo(() => soilRows(bundle, dates, start, end, (d) => d.ece, (s) => s.ece, p.overlay), [bundle, dates, start, end, p.overlay]);
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
        height={p.height}
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
      />
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Farm mean" },
          ...(p.showProbes ? [{ kind: "line" as const, color: PROBE_COLORS[0], label: "Each probe" }] : [{ kind: "band" as const, color: C.range, label: "Probe range" }]),
          { kind: "dash", color: C.threshold, label: `${crop.name} limit ${fmtNum(threshold, 1)} dS/m` },
          ...(p.overlayLabel ? [{ kind: "dash" as const, color: C.overlay, label: p.overlayLabel }] : []),
        ]}
      />
      <PanelFooter
        stats={
          <>
            <Stat label="Yield at risk" value={loss == null ? "—" : `${fmtNum(loss, 0)}%`} />
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

export function MoisturePanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const rows = useMemo(() => {
    const base = soilRows(bundle, dates, start, end, (d) => d.moisture, (s) => s.moisture, p.overlay);
    const trigger = triggerSeries(bundle, start, end);
    return base.map((r, i) => ({ ...r, ref: trigger[i] }));
  }, [bundle, dates, start, end, p.overlay]);
  const scale = useMemo(
    () => niceScale(rows.flatMap((r) => [r.value, r.range?.[0], r.range?.[1], r.ref, r.overlay]), { minSpan: 20, zero: true }),
    [rows],
  );
  const latest = latestIn(bundle, start, end);
  const d = latest?.day ?? null;
  const t = trend(bundle, latest?.index ?? end, end - start + 1, (x) => x.moisture);
  const change = t.changePct;
  const plan = irrigationPlan(d, dates, latest?.index ?? end);
  const deficitClass = d?.deficitPct != null ? classFor(METRICS.deficit, d.deficitPct)?.label : null;
  const days = t.days;
  const stressed = (d?.deficitPct ?? 0) > 100;
  const lastRef = [...rows].reverse().find((r) => r.ref != null)?.ref ?? null;

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
        marginLabels={lastRef != null ? [{ y: lastRef, text: p.narrow ? "Irrigate" : "Irrigate below", tone: "threshold" }] : []}
        narrow={p.narrow}
        markers={p.markers}
        overlayLabel={p.overlayLabel}
        probeIds={probeIdsOf(bundle)}
        showProbes={p.showProbes}
      />
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Farm mean" },
          ...(p.showProbes ? [{ kind: "line" as const, color: PROBE_COLORS[0], label: "Each probe" }] : [{ kind: "band" as const, color: C.range, label: "Probe range" }]),
          { kind: "dash", color: C.threshold, label: "Irrigation trigger (readily available water used up)" },
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

function NutrientStrip({ bundle, dates, start, end, k, height, showXAxis, markers, narrow }: { bundle: FarmBundle; dates: string[]; start: number; end: number; k: NutrientKey; height: number; showXAxis: boolean; markers: PanelProps["markers"]; narrow: boolean }) {
  const g = NUTRIENT_GUIDE[k];
  const rows = useMemo(() => soilRows(bundle, dates, start, end, (d) => d[k], (s) => s[k]), [bundle, dates, start, end, k]);
  const scale = useMemo(() => niceScale(rows.flatMap((r) => [r.value, r.range?.[1]]), { minSpan: g.chartMax, zero: true, atLeast: g.chartMax }), [rows, g.chartMax]);
  const latest = latestIn(bundle, start, end)?.day ?? null;
  const summary = nutrientSummary(latest).find((s) => s.key === k);
  return (
    <div>
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
          <NutrientStrip key={k} bundle={bundle} dates={dates} start={start} end={end} k={k} height={stripHeight} showXAxis={i === 2} markers={p.markers} narrow={p.narrow} />
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

