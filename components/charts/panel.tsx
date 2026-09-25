"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Change over the range: neutral with an arrow, red only when the change is itself a risk signal. */
export function ChangeChip({ value, text, risk = false }: { value: number | null; text: string; risk?: boolean }) {
  if (value == null) return null;
  const Icon = Math.abs(value) < 0.5 ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap tabular",
        risk ? "bg-risk-high-soft text-risk-high-ink" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Headline value · class in words · change, then one plain sentence. */
export function Headline({
  value,
  unit,
  label,
  change,
  sentence,
}: {
  value: string;
  unit?: string;
  label?: React.ReactNode;
  change?: React.ReactNode;
  sentence: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xl font-semibold tracking-tight tabular">
          {value}
          {unit ? <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span> : null}
        </span>
        {label ? <span className="text-sm font-medium">{label}</span> : null}
        {change}
      </div>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">{sentence}</p>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular">{value}</span>
    </span>
  );
}

/** Secondary stats, the data source, and the hand-off to the assistant. */
export function PanelFooter({ stats, source, askHref, askLabel = "Ask AI about this chart" }: { stats: React.ReactNode; source: string; askHref?: string; askLabel?: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">{stats}</div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        <span className="text-xs text-muted-foreground">{source}</span>
        {askHref ? (
          <Link
            href={askHref}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary sm:min-h-8 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {askLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Screen-reader summary of a chart, built from its headline and meaning lines. */
export function ChartSummary({ children }: { children: React.ReactNode }) {
  return <p className="sr-only">{children}</p>;
}
