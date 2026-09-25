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
import { CROPS } from "@/lib/agronomy-tables";
import { chartRows, type ChartOverlay, type ChartRow } from "@/lib/dashboard";
import { formatDay, formatShortDay } from "@/lib/format";
import { classFor, formatValue, type MetricDef } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLOR_MEAN = "var(--primary)";
const COLOR_RANGE = "oklch(0.6 0.1 158)";
const COLOR_OVERLAY = "oklch(0.6 0.13 62)";
const COLOR_REFERENCE = "oklch(0.5 0.03 250)";
const COLOR_THRESHOLD = "oklch(0.5 0.17 27)";

interface ReferenceSpec {
  label: string;
  dashed: boolean;
}

function referenceSpec(metric: MetricDef): ReferenceSpec | null {
  if (metric.key === "et0") return { label: "Open-Meteo ET₀ (cross-check)", dashed: true };
  if (metric.key === "etc") return { label: "ET₀", dashed: false };
  if (metric.key === "moisture") return { label: "Irrigation trigger (RAW)", dashed: true };
  return null;
}

function thresholdLine(metric: MetricDef, bundle: FarmBundle): { y: number; label: string } | null {
  if (metric.key === "ece") {
    const crop = CROPS[bundle.farm.main_crop];
    return { y: crop.salinity.threshold_dS_per_m, label: `${crop.name} threshold` };
  }
  if (metric.key === "deficit") return { y: 100, label: "Irrigate (RAW used)" };
  return null;
}

/** Round tick steps; the scale uses the smallest one that gives at most five intervals. */
const TICK_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];

interface Scale {
  domain: [number, number];
  ticks: number[];
  decimals: number;
}

function niceScale(metric: MetricDef, rows: ChartRow[], extra: number[]): Scale {
  const values: number[] = [...extra];
  for (const r of rows) {
    if (r.value != null) values.push(r.value);
    if (r.range) values.push(r.range[0], r.range[1]);
    if (r.overlay != null) values.push(r.overlay);
    if (r.reference != null) values.push(r.reference);
  }
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { domain: [0, 1], ticks: [0, 1], decimals: 0 };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  const pad = (hi - lo) * 0.12 || Math.max(Math.abs(hi) * 0.1, metric.key === "ph" ? 0.2 : 1);
  lo -= pad;
  hi += pad;
  if (metric.key !== "ph" && metric.key !== "temperature") lo = Math.max(0, lo);
  if (metric.key === "yieldLoss") hi = Math.min(100, Math.max(hi, 10));
  const step = TICK_STEPS.find((t) => (hi - lo) / t <= 5) ?? 100;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 1000; v += step) ticks.push(Number(v.toFixed(4)));
  const decimals = Number.isInteger(step) ? 0 : Number.isInteger(step * 10) ? 1 : 2;
  return { domain: [min, max], ticks, decimals };
}

function ChartTooltip({
  active,
  payload,
  metric,
  overlayLabel,
  reference,
}: TooltipContentProps<number, string> & { metric: MetricDef; overlayLabel: string | null; reference: ReferenceSpec | null }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  const cls = classFor(metric, row.value);
  return (
    <div className="min-w-44 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg">
      <div className="mb-1 font-semibold">{formatDay(row.date)}</div>
      {row.value == null ? (
        <div className="text-muted-foreground">No readings</div>
      ) : (
        <div className="space-y-0.5 tabular">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR_MEAN }} />
            Farm mean <span className="ml-auto pl-3 font-semibold">{formatValue(metric, row.value)}</span>
          </div>
          {row.range ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2 w-3 rounded-sm opacity-40" style={{ background: COLOR_RANGE }} />
              Probe range
              <span className="ml-auto pl-3">
                {formatValue(metric, row.range[0], false)}–{formatValue(metric, row.range[1], false)}
              </span>
            </div>
          ) : null}
          {overlayLabel && row.overlay != null ? (
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR_OVERLAY }} />
              <span className="max-w-36 truncate">{overlayLabel}</span>
              <span className="ml-auto pl-3 font-semibold">{formatValue(metric, row.overlay)}</span>
            </div>
          ) : null}
          {reference && row.reference != null ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR_REFERENCE }} />
              <span className="max-w-36 truncate">{reference.label}</span>
              <span className="ml-auto pl-3">{formatValue(metric, row.reference)}</span>
            </div>
          ) : null}
          {cls ? <div className="pt-0.5 text-muted-foreground">{cls.label}</div> : null}
        </div>
      )}
    </div>
  );
}

function LegendSwatch({ kind, color, label }: { kind: "line" | "dash" | "band"; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "band" ? (
        <span className="h-2.5 w-4 rounded-sm opacity-35" style={{ background: color }} />
      ) : (
        <svg width="16" height="4" aria-hidden="true">
          <line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth="2" strokeDasharray={kind === "dash" ? "4 3" : undefined} />
        </svg>
      )}
      {label}
    </span>
  );
}

/** The swatches every chart shares, shown once above a grid of charts drawn with showLegend="specific". */
export function ChartKey({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground", className)}>
      <LegendSwatch kind="line" color={COLOR_MEAN} label="Farm mean" />
      <LegendSwatch kind="band" color={COLOR_RANGE} label="Probe min–max" />
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-[linear-gradient(90deg,#fecc5c,#c7e9b4,#92c5de)] opacity-50" aria-hidden="true" />
        Shaded bands: value classes
      </span>
    </div>
  );
}

/**
 * A metric over time for one farm: farm mean, min–max across probes, the metric's fixed class
 * bands and thresholds, an optional comparison series and day markers.
 */
export function MetricChart({
  bundle,
  metric,
  dates,
  endIndex,
  rangeDays,
  overlay = { kind: "none" },
  overlayLabel = null,
  markers = [],
  height = 260,
  showLegend = true,
  className,
}: {
  bundle: FarmBundle;
  metric: MetricDef;
  dates: string[];
  endIndex: number;
  rangeDays: number;
  overlay?: ChartOverlay;
  overlayLabel?: string | null;
  markers?: Array<{ index: number; label: string }>;
  height?: number;
  /** "specific": only this chart's own lines (threshold, reference, overlay) — pair with <ChartKey />. */
  showLegend?: boolean | "specific";
  className?: string;
}) {
  const start = Math.max(0, endIndex - rangeDays + 1);
  const rows = useMemo(
    () => chartRows(bundle, metric, dates, start, endIndex, overlay),
    [bundle, metric, dates, start, endIndex, overlay],
  );
  const reference = referenceSpec(metric);
  const threshold = thresholdLine(metric, bundle);
  const scale = useMemo(() => niceScale(metric, rows, threshold ? [threshold.y] : []), [metric, rows, threshold]);
  const { domain } = scale;
  const hasData = rows.some((r) => r.value != null);
  const hasRange = rows.some((r) => r.range != null);
  const tickEvery = rangeDays <= 7 ? 1 : rangeDays <= 30 ? 5 : 10;
  const ticks = rows
    .map((r) => r.date)
    .filter((_, i, all) => (all.length - 1 - i) % tickEvery === 0);

  const bands = metric.classes
    .map((c) => ({ ...c, y1: Math.max(c.min, domain[0]), y2: Math.min(c.max, domain[1]) }))
    .filter((c) => c.y2 > c.y1);

  if (!hasData) {
    return (
      <div
        className={cn("flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground", className)}
        style={{ height }}
      >
        No {metric.label.toLowerCase()} readings in this period.
      </div>
    );
  }

  return (
    <div className={className}>
      {showLegend ? (
        <div
          className={cn(
            "mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground",
            showLegend === "specific" && "min-h-[18px]",
          )}
        >
          {showLegend === true ? <LegendSwatch kind="line" color={COLOR_MEAN} label="Farm mean" /> : null}
          {showLegend === true && hasRange ? <LegendSwatch kind="band" color={COLOR_RANGE} label="Probe min–max" /> : null}
          {overlayLabel ? <LegendSwatch kind="dash" color={COLOR_OVERLAY} label={overlayLabel} /> : null}
          {reference ? <LegendSwatch kind={reference.dashed ? "dash" : "line"} color={COLOR_REFERENCE} label={reference.label} /> : null}
          {threshold ? <LegendSwatch kind="dash" color={COLOR_THRESHOLD} label={`${threshold.label} ${threshold.y} ${metric.unit}`} /> : null}
        </div>
      ) : null}
      <div style={{ height }} role="img" aria-label={`${metric.label} for ${bundle.farm.name}, last ${rows.length} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
            {bands.map((b) => (
              <ReferenceArea
                key={b.label}
                y1={b.y1}
                y2={b.y2}
                fill={b.color}
                fillOpacity={0.2}
                stroke="none"
                ifOverflow="hidden"
                label={
                  (b.y2 - b.y1) / (domain[1] - domain[0]) > 0.16
                    ? { value: b.label, position: "insideTopLeft", fontSize: 12, fill: "oklch(0.45 0.02 120)" }
                    : undefined
                }
              />
            ))}
            <CartesianGrid vertical={false} stroke="oklch(0.3 0.02 120 / 0.1)" />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={(d: string) => formatShortDay(d)}
              tick={{ fontSize: 12, fill: "oklch(0.47 0.025 115)" }}
              tickLine={false}
              axisLine={{ stroke: "oklch(0.3 0.02 120 / 0.2)" }}
              minTickGap={8}
            />
            <YAxis
              domain={domain}
              ticks={scale.ticks}
              allowDataOverflow
              width={scale.decimals > 0 ? 40 : 36}
              tick={{ fontSize: 12, fill: "oklch(0.47 0.025 115)" }}
              tickFormatter={(v: number) =>
                v.toLocaleString("en-US", { minimumFractionDigits: scale.decimals, maximumFractionDigits: scale.decimals })
              }
              tickLine={false}
              axisLine={false}
            />
            {hasRange ? (
              <Area
                dataKey="range"
                stroke="none"
                fill={COLOR_RANGE}
                fillOpacity={0.22}
                isAnimationActive={false}
                connectNulls
                activeDot={false}
              />
            ) : null}
            {threshold ? (
              <ReferenceLine
                y={threshold.y}
                stroke={COLOR_THRESHOLD}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              />
            ) : null}
            {reference ? (
              <Line
                dataKey="reference"
                stroke={COLOR_REFERENCE}
                strokeWidth={1.5}
                strokeDasharray={reference.dashed ? "4 3" : undefined}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
            {overlay.kind !== "none" ? (
              <Line
                dataKey="overlay"
                stroke={COLOR_OVERLAY}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls
                animationDuration={400}
              />
            ) : null}
            <Line
              dataKey="value"
              stroke={COLOR_MEAN}
              strokeWidth={2.25}
              dot={rows.length <= 10 ? { r: 3, fill: COLOR_MEAN, strokeWidth: 0 } : false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls
              animationDuration={400}
            />
            {markers
              .filter((m) => m.index >= start && m.index <= endIndex)
              .map((m) => (
                <ReferenceLine
                  key={`${m.label}-${m.index}`}
                  x={dates[m.index]}
                  stroke="oklch(0.26 0.05 162)"
                  strokeWidth={1.5}
                  strokeDasharray={m.label === "Then" ? "3 3" : undefined}
                  label={{ value: m.label, position: "insideTopRight", fontSize: 12, fontWeight: 600, fill: "oklch(0.26 0.05 162)" }}
                />
              ))}
            <Tooltip
              cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
              content={(props) => (
                <ChartTooltip {...(props as TooltipContentProps<number, string>)} metric={metric} overlayLabel={overlayLabel} reference={reference} />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
