"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RiskLevel } from "@/lib/ai/contract";
import { formatDay, formatShortDay } from "@/lib/format";
import type { RiskPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The same cut-offs as the model's risk levels (lib/ai/model-output.ts). */
const ZONES: Array<{ level: RiskLevel; from: number; to: number; label: string; color: string }> = [
  { level: "high", from: 70, to: 100, label: "High", color: "var(--risk-high)" },
  { level: "medium", from: 40, to: 70, label: "Medium", color: "var(--risk-medium)" },
  { level: "low", from: 0, to: 40, label: "Low", color: "var(--risk-low)" },
];

const levelOf = (score: number): RiskLevel => (score >= 70 ? "high" : score >= 40 ? "medium" : "low");
const zoneOf = (score: number) => ZONES.find((z) => z.level === levelOf(score))!;

const TOP = 8;
const BOTTOM = 22;
const RIGHT = 56;

/**
 * The risk score over time on its fixed 0–100 scale, with the low / medium / high zones shaded
 * and named. The line takes the colour of the zone it is in, the peak and today are labelled,
 * and hovering (or the arrow keys) reads any day.
 */
export function RiskTrendChart({ points, level, height = 132, className }: { points: RiskPoint[]; level: RiskLevel | null; height?: number; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const gradId = `risk-${useId().replace(/[^\w-]/g, "")}`;

  // The chart box only exists with two or more points: observe it once it appears.
  const ready = points.length >= 2;
  useEffect(() => {
    const el = wrap.current;
    if (!ready || !el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  if (!ready) return <p className={cn("text-xs text-muted-foreground", className)}>No history yet</p>;

  const n = points.length;
  const W = Math.max(200, width);
  const x0 = 2;
  const x1 = W - RIGHT;
  const x = (i: number) => x0 + (i * (x1 - x0)) / (n - 1);
  const y = (score: number) => TOP + ((100 - Math.min(100, Math.max(0, score))) * (height - TOP - BOTTOM)) / 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;

  const last = points[n - 1];
  const peakI = points.reduce((best, p, i) => (p.score > points[best].score ? i : best), 0);
  const peak = points[peakI];
  const showPeak = peakI < n - 2 && peak.score >= last.score + 5;
  const mid = Math.round((n - 1) / 2);
  const lastColor = level ? ZONES.find((z) => z.level === level)!.color : zoneOf(last.score).color;

  const label = `Risk score over the last ${n} days: ${points[0].score} on ${formatShortDay(points[0].date)}, peak ${peak.score} on ${formatShortDay(peak.date)}, ${last.score} out of 100 today`;
  const hover = active != null ? points[active] : null;

  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const px = clientX - el.getBoundingClientRect().left;
    setActive(Math.min(n - 1, Math.max(0, Math.round(((px - x0) / (x1 - x0)) * (n - 1)))));
  };

  return (
    <div
      ref={wrap}
      className={cn("relative outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/60", className)}
      style={{ height }}
      role="img"
      aria-label={label}
      tabIndex={0}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const step = e.key === "ArrowLeft" ? -1 : 1;
          setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + (a == null ? 0 : step))));
        } else if (e.key === "Escape") setActive(null);
      }}
    >
      {width > 0 ? (
        <svg width={W} height={height} className="absolute inset-0 overflow-visible" aria-hidden="true">
          <defs>
            {/* Hard stops at 70 and 40: the line is red in the high zone, amber in medium, green in low. */}
            <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={y(100)} y2={y(0)}>
              <stop offset="0" stopColor="var(--risk-high)" />
              <stop offset={0.3} stopColor="var(--risk-high)" />
              <stop offset={0.3} stopColor="var(--risk-medium)" />
              <stop offset={0.6} stopColor="var(--risk-medium)" />
              <stop offset={0.6} stopColor="var(--risk-low)" />
              <stop offset="1" stopColor="var(--risk-low)" />
            </linearGradient>
          </defs>
          {ZONES.map((z) => (
            <g key={z.level}>
              <rect x={x0} width={x1 - x0} y={y(z.to)} height={y(z.from) - y(z.to)} fill={z.color} fillOpacity={0.07} />
              <text x={x1 + 8} y={(y(z.to) + y(z.from)) / 2 + 4} fontSize={12} fill="var(--muted-foreground)">
                {z.label}
              </text>
            </g>
          ))}
          {[40, 70].map((b) => (
            <line key={b} x1={x0} x2={x1} y1={y(b)} y2={y(b)} stroke="var(--border)" strokeDasharray="2 3" />
          ))}
          <line x1={x0} x2={x1} y1={y(0)} y2={y(0)} stroke="var(--border)" />
          <path d={area} fill={`url(#${gradId})`} fillOpacity={0.12} />
          <path d={line} fill="none" stroke={`url(#${gradId})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {showPeak ? (
            <g>
              <circle cx={x(peakI)} cy={y(peak.score)} r={2.5} fill={zoneOf(peak.score).color} />
              <text
                x={x(peakI)}
                y={y(peak.score) - 6}
                fontSize={12}
                textAnchor={peakI < 3 ? "start" : "middle"}
                fill="var(--foreground)"
                stroke="var(--card)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                Peak {peak.score}
              </text>
            </g>
          ) : null}
          {hover && active != null ? (
            <g>
              <line x1={x(active)} x2={x(active)} y1={TOP} y2={y(0)} stroke="var(--foreground)" strokeOpacity={0.35} />
              <circle cx={x(active)} cy={y(hover.score)} r={4} fill={zoneOf(hover.score).color} stroke="var(--card)" strokeWidth={2} />
            </g>
          ) : null}
          <circle cx={x(n - 1)} cy={y(last.score)} r={4} fill={lastColor} stroke="var(--card)" strokeWidth={2} />
          {[...new Set([0, mid, n - 1])].map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              fontSize={12}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fill="var(--muted-foreground)"
            >
              {i === n - 1 ? "Today" : formatShortDay(points[i].date)}
            </text>
          ))}
        </svg>
      ) : null}
      {hover && active != null ? (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-card px-2 py-1 text-xs whitespace-nowrap shadow-md tabular"
          style={{
            // Centred on the day, or held inside the chart near either end.
            ...(x(active) < 110 ? { left: Math.max(0, x(active) - 16) } : x(active) > W - 110 ? { right: Math.max(0, W - x(active) - 16) } : { left: x(active), transform: "translateX(-50%)" }),
            // Above the point, or below it when the score is near the top.
            top: y(hover.score) - 40 >= 0 ? y(hover.score) - 40 : y(hover.score) + 12,
          }}
        >
          <span className="font-semibold">{hover.score}</span>
          <span className="text-muted-foreground"> / 100 · {zoneOf(hover.score).label.toLowerCase()} · </span>
          {active === n - 1 ? "today" : formatDay(hover.date)}
        </div>
      ) : null}
    </div>
  );
}
