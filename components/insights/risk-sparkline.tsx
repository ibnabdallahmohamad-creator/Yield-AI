import type { RiskLevel } from "@/lib/ai/contract";
import type { RiskPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

const DOT: Record<RiskLevel, string> = { high: "fill-risk-high", medium: "fill-risk-medium", low: "fill-risk-low" };

/**
 * Risk score over time on a fixed 0–100 scale, so farms compare honestly side by side. The line is
 * neutral; only the latest point carries the risk colour. Faint rules mark the 40 and 70 bands.
 */
export function RiskSparkline({
  points,
  level,
  width = 112,
  height = 36,
  className,
}: {
  points: RiskPoint[];
  level: RiskLevel | null;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return <span className={cn("text-xs text-muted-foreground", className)}>No history yet</span>;
  const pad = 3;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (score: number) => pad + ((100 - Math.min(100, Math.max(0, score))) * (height - 2 * pad)) / 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${height - pad}L${pad},${height - pad}Z`;
  const first = points[0].score;
  const last = points[points.length - 1].score;
  const label = `Risk score over the last ${points.length} days: ${first} to ${last} out of 100`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className={cn("shrink-0 overflow-visible", className)}>
      {[40, 70].map((band) => (
        <line key={band} x1={pad} x2={width - pad} y1={y(band)} y2={y(band)} className="stroke-border" strokeDasharray="2 3" strokeWidth={1} />
      ))}
      <path d={area} className="fill-foreground/5" />
      <path d={line} className="fill-none stroke-foreground/55" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r={3.5} className={cn("stroke-card", level ? DOT[level] : "fill-muted-foreground")} strokeWidth={1.5} />
    </svg>
  );
}
