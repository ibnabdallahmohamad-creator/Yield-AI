"use client";

/**
 * Shared chart pieces for the Soil & weather card (ui_improvement §7.4): nice y-scales with a
 * minimum span so noise isn't exaggerated, band labels in the right margin (never over the data),
 * a legend per chart, one x-axis format and a "Today" rule.
 */
import { usePlotArea, useYAxisScale } from "recharts";
import { formatShortDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export const C = {
  /** The farm line is always the brand forest green. */
  mean: "var(--primary)",
  /** Probe range: neutral grey-green. */
  range: "oklch(0.62 0.04 150)",
  forecast: "oklch(0.55 0.05 150)",
  overlay: "oklch(0.6 0.13 62)",
  reference: "oklch(0.5 0.03 250)",
  /** Red only on risk thresholds (crop limit, heat line, irrigation trigger). */
  threshold: "oklch(0.55 0.18 27)",
  adequate: "oklch(0.62 0.13 152)",
  rain: "oklch(0.56 0.11 240)",
  grid: "oklch(0.3 0.02 120 / 0.09)",
  axis: "oklch(0.47 0.025 115)",
  today: "oklch(0.26 0.05 162)",
} as const;

export const AXIS_TICK = { fontSize: 12, fill: C.axis };
export const RIGHT_MARGIN = 104;
/** Room for the margin labels: less on phones, where the labels are shorter too. */
export const rightMargin = (narrow: boolean) => (narrow ? 76 : RIGHT_MARGIN);

const TICK_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];

export interface Scale {
  domain: [number, number];
  ticks: number[];
  decimals: number;
}

/**
 * A y-scale with round ticks (at most five intervals). `minSpan` keeps a flat series from filling
 * the whole chart (a 0.1 pH wobble shouldn't look alarming); `zero` pins the baseline at 0.
 */
export function niceScale(values: Array<number | null | undefined>, opts: { minSpan: number; zero?: boolean; atLeast?: number; atMost?: number }): Scale {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (opts.atLeast != null) finite.push(opts.atLeast);
  if (finite.length === 0) return { domain: [0, 1], ticks: [0, 1], decimals: 0 };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (opts.zero) lo = Math.min(0, lo);
  const pad = (hi - lo) * 0.08;
  hi += pad;
  if (!opts.zero) lo -= pad;
  if (hi - lo < opts.minSpan) {
    if (opts.zero) hi = lo + opts.minSpan;
    else {
      const mid = (hi + lo) / 2;
      lo = mid - opts.minSpan / 2;
      hi = mid + opts.minSpan / 2;
    }
  }
  if (opts.zero) lo = Math.max(0, lo);
  if (opts.atMost != null) hi = Math.min(opts.atMost, hi);
  const step = TICK_STEPS.find((t) => (hi - lo) / t <= 5) ?? 1000;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 1000; v += step) ticks.push(Number(v.toFixed(4)));
  const decimals = Number.isInteger(step) ? 0 : Number.isInteger(step * 10) ? 1 : 2;
  return { domain: [min, max], ticks, decimals };
}

export function tickFormatter(decimals: number) {
  return (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** At most five evenly spaced x ticks, always including the last day. */
export function xTicks(dates: string[], max = 5): string[] {
  if (dates.length <= max) return dates;
  const step = Math.ceil((dates.length - 1) / (max - 1));
  const out: string[] = [];
  for (let i = dates.length - 1; i >= 0; i -= step) out.unshift(dates[i]);
  return out;
}

export const formatX = (d: string) => formatShortDay(d);

export interface MarginLabel {
  y: number;
  text: string;
  tone?: "threshold" | "muted" | "adequate";
}

/**
 * Labels drawn in the chart's right margin at a y value (band names, the crop limit, the heat
 * line). Threshold labels keep their exact height; a band name that would touch one is moved
 * the shortest way clear (at most one line), or left out. Render as a child of a Recharts chart.
 */
export function MarginLabels({ labels }: { labels: MarginLabel[] }) {
  const area = usePlotArea();
  const scale = useYAxisScale();
  if (!area || !scale) return null;
  const top = area.y + 8;
  const bottom = area.y + area.height - 2;
  const GAP = 16;
  const placed: Array<MarginLabel & { py: number }> = [];
  const clear = (py: number) => py >= top && py <= bottom && placed.every((o) => Math.abs(o.py - py) >= GAP);
  const byImportance = [...labels].sort((a, b) => Number(b.tone === "threshold") - Number(a.tone === "threshold") || b.y - a.y);
  for (const l of byImportance) {
    const raw = scale(l.y);
    if (raw == null || !Number.isFinite(raw) || raw < area.y - 1 || raw > area.y + area.height + 1) continue;
    const at = Math.min(bottom, Math.max(top, raw + 4));
    const py = [0, -1, 1, -4, 4, -8, 8, -12, 12, -GAP, GAP].map((d) => at + d).find(clear);
    if (py != null) placed.push({ ...l, py });
  }
  const x = area.x + area.width + 8;
  return (
    <g aria-hidden="true">
      {placed.map((l) => (
        <text
          key={`${l.text}-${l.y}`}
          x={x}
          y={l.py}
          fontSize={12}
          fontWeight={l.tone === "threshold" ? 600 : 500}
          fill={l.tone === "threshold" ? C.threshold : l.tone === "adequate" ? "oklch(0.45 0.1 152)" : C.axis}
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}

/** Diagonal hatch for forecast bars and bands. Render inside a chart as `<defs>`. */
export function HatchDefs({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={color} fillOpacity={0.12} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" strokeOpacity={0.55} />
      </pattern>
    </defs>
  );
}

export function Swatch({ kind, color }: { kind: "line" | "dash" | "band" | "bar" | "hatch"; color: string }) {
  if (kind === "band") return <span className="h-2.5 w-4 rounded-sm" style={{ background: color, opacity: 0.35 }} aria-hidden="true" />;
  if (kind === "bar") return <span className="h-3 w-2 rounded-sm" style={{ background: color }} aria-hidden="true" />;
  if (kind === "hatch")
    return (
      <span
        className="h-3 w-3 rounded-sm"
        style={{ background: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)`, opacity: 0.7 }}
        aria-hidden="true"
      />
    );
  return (
    <svg width="16" height="4" aria-hidden="true">
      <line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth="2" strokeDasharray={kind === "dash" ? "4 3" : undefined} />
    </svg>
  );
}

/** A legend that lists only the series actually drawn. */
export function Legend({ items, className, children }: { items: Array<{ kind: Parameters<typeof Swatch>[0]["kind"]; color: string; label: string }>; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch kind={i.kind} color={i.color} />
          {i.label}
        </span>
      ))}
      {children}
    </div>
  );
}

export function TooltipShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-48 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{title}</div>
      <div className="space-y-0.5 tabular">{children}</div>
    </div>
  );
}

export function TooltipRow({ label, value, color, kind = "line", muted }: { label: string; value: string; color?: string; kind?: Parameters<typeof Swatch>[0]["kind"]; muted?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", muted && "text-muted-foreground")}>
      {color ? <Swatch kind={kind} color={color} /> : <span className="w-4" />}
      <span className="max-w-40 truncate">{label}</span>
      <span className={cn("ml-auto pl-3", !muted && "font-semibold")}>{value}</span>
    </div>
  );
}
