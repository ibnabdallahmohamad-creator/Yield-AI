import { AlertTriangle, CircleAlert, CircleCheck } from "lucide-react";
import type { RiskLevel } from "@/lib/ai/contract";
import { cn } from "@/lib/utils";

const STYLE: Record<RiskLevel, { label: string; className: string; Icon: typeof AlertTriangle }> = {
  high: { label: "High risk", className: "bg-risk-high-soft text-risk-high-ink ring-risk-high/25", Icon: AlertTriangle },
  medium: { label: "Medium risk", className: "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40", Icon: CircleAlert },
  low: { label: "Low risk", className: "bg-risk-low-soft text-risk-low-ink ring-risk-low/25", Icon: CircleCheck },
};

export const RISK_BAR: Record<RiskLevel, string> = {
  high: "bg-risk-high",
  medium: "bg-risk-medium",
  low: "bg-risk-low",
};

export function riskLabel(level: RiskLevel): string {
  return STYLE[level].label;
}

/** Risk chip — icon + text + score, never colour alone. */
export function RiskBadge({
  level,
  score,
  compact = false,
  className,
}: {
  level: RiskLevel;
  score?: number | null;
  /** Compact: icon + score only (for dense lists). */
  compact?: boolean;
  className?: string;
}) {
  const s = STYLE[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ring-1 ring-inset",
        compact ? "h-5.5 px-1.5 text-[11.5px]" : "h-6 px-2.5 text-xs",
        s.className,
        className,
      )}
    >
      <s.Icon className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
      {compact ? (
        <>
          <span className="sr-only">{s.label}, score </span>
          <span className="tabular">{score ?? "—"}</span>
        </>
      ) : (
        <>
          {s.label}
          {score != null ? <span className="tabular opacity-80">· {score}</span> : null}
        </>
      )}
    </span>
  );
}
