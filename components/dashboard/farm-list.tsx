"use client";

import { InfoTip } from "@/components/dashboard/info-tip";
import { RISK_BAR, RiskBadge } from "@/components/dashboard/risk-badge";
import { CROPS } from "@/lib/agronomy-tables";
import { colorFor, formatCompact, type Delta, type MetricDef } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FarmListItem {
  bundle: FarmBundle;
  value: number | null;
  delta: Delta | null;
  /** Live mode: when this farm last reported (restarts the flash). */
  flashAt?: number;
}

/** Farms ranked by AI risk score, with the selected metric's value on the shown day. */
export function FarmList({
  items,
  metric,
  selectedId,
  onSelect,
  compare,
  dayLabel,
  className,
}: {
  items: FarmListItem[];
  metric: MetricDef;
  selectedId: string;
  onSelect: (id: string) => void;
  compare: boolean;
  /** The day the values describe, e.g. "24 Sep". */
  dayLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1.5 px-1">
        <h2 className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Farms · {items.length}</h2>
        <InfoTip label="How farms are ranked" side="right">
          Ranked by the AI risk score (0–100) of each farm&apos;s latest insight. The value shows the selected map layer on the
          selected day{compare ? "; the badge is the change since the “then” day" : ""}.
        </InfoTip>
      </div>
      <p className="truncate px-1 pt-0.5 pb-2 text-[12px] text-muted-foreground">
        Ranked by risk · {metric.label}, {dayLabel}
        {compare ? " vs then" : ""}
      </p>
      <ul className="space-y-1.5" aria-label="Farms ranked by risk">
        {items.map(({ bundle, value, delta, flashAt }, rank) => {
          const { farm, insight } = bundle;
          const selected = farm.id === selectedId;
          return (
            <li key={farm.id}>
              <button
                type="button"
                onClick={() => onSelect(farm.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "group relative flex w-full items-start gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  selected
                    ? "border-primary/40 bg-card shadow-sm ring-1 ring-primary/20"
                    : "border-transparent bg-card/50 hover:border-border hover:bg-card",
                )}
              >
                <span
                  key={flashAt}
                  className={cn("pointer-events-none absolute inset-0 rounded-xl", flashAt ? "yai-flash" : undefined)}
                  aria-hidden="true"
                />
                <span
                  className={cn("absolute inset-y-2 left-0 w-1 rounded-r-full", insight ? RISK_BAR[insight.risk_level] : "bg-muted")}
                  aria-hidden="true"
                />
                <span className="w-3.5 shrink-0 pt-px text-[12px] font-semibold text-muted-foreground tabular">{rank + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[14px] leading-snug font-semibold", selected && "text-primary")}>
                    {farm.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    {CROPS[farm.main_crop].name} · {farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: 1 })} ha ·{" "}
                    {farm.region}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-[12px]">
                    <span
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-black/15"
                      style={{ background: colorFor(metric, value) }}
                      aria-hidden="true"
                    />
                    <span className="font-semibold whitespace-nowrap tabular">{formatCompact(metric, value)}</span>
                    {compare && delta ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-px text-[11px] font-bold whitespace-nowrap tabular",
                          delta.tone === "bad" && "bg-risk-high-soft text-risk-high-ink",
                          delta.tone === "good" && "bg-risk-low-soft text-risk-low-ink",
                          delta.tone === "neutral" && "bg-muted text-muted-foreground",
                        )}
                        title="Change since the “then” day"
                      >
                        {delta.text}
                      </span>
                    ) : null}
                    {insight ? (
                      <RiskBadge level={insight.risk_level} score={Math.round(insight.risk_score)} compact className="ml-auto shrink-0" />
                    ) : (
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">No insight</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
