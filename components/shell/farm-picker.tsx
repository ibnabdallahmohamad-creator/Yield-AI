"use client";

import { Check } from "lucide-react";
import { HealthDot, RISK_TONE, riskLabel } from "@/components/dashboard/risk-badge";
import type { ShellFarm } from "@/components/shell/shell-context";
import { cn } from "@/lib/utils";

/**
 * Farms ranked by risk: a risk dot, the name, and the crop with the reason in words
 * ("Drying out", "Salt rising"). `extra` adds a value on the right (e.g. the selected map layer).
 */
export function FarmPicker({
  farms,
  selectedId,
  onSelect,
  extra,
  flashes,
  className,
  label = "Farms ranked by risk",
}: {
  farms: ShellFarm[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  extra?: Record<string, React.ReactNode>;
  /** Live mode: when each farm last reported (restarts the flash). */
  flashes?: Record<string, number>;
  className?: string;
  label?: string;
}) {
  return (
    <ul className={cn("space-y-1", className)} aria-label={label}>
      {farms.map((farm) => {
        const selected = farm.id === selectedId;
        const flashAt = flashes?.[farm.id];
        return (
          <li key={farm.id}>
            <button
              type="button"
              onClick={() => onSelect(farm.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "group relative flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                selected ? "bg-card shadow-xs ring-1 ring-primary/25" : "hover:bg-card/70",
              )}
            >
              <span
                key={flashAt}
                className={cn("pointer-events-none absolute inset-0 rounded-xl", flashAt ? "yai-flash" : undefined)}
                aria-hidden="true"
              />
              <HealthDot
                tone={farm.riskLevel ? RISK_TONE[farm.riskLevel] : "none"}
                label={farm.riskLevel ? `${riskLabel(farm.riskLevel)}${farm.riskScore != null ? `, score ${farm.riskScore}` : ""}` : "No insight yet"}
              />
              <span className="relative min-w-0 flex-1">
                <span className={cn("block truncate text-sm leading-snug font-semibold", selected && "text-primary")}>{farm.name}</span>
                <span className="block truncate text-xs leading-snug text-muted-foreground">
                  {farm.crop} · <span className={cn(farm.reasonTone === "bad" && "font-medium text-foreground")}>{farm.reason}</span>
                </span>
              </span>
              {extra?.[farm.id] != null ? <span className="relative shrink-0 text-right text-xs">{extra[farm.id]}</span> : null}
              {selected && extra?.[farm.id] == null ? <Check className="relative size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The count on a "Farms" button: how many need attention, or just how many there are. */
export function FarmsCount({ farms }: { farms: ShellFarm[] }) {
  const high = farms.filter((f) => f.riskLevel === "high").length;
  if (!high) return <span className="font-normal text-muted-foreground">{farms.length}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-normal text-risk-high-ink">
      <HealthDot tone="bad" />
      {high} high risk
    </span>
  );
}
