"use client";

import { ChevronDown, Sparkles, Sprout, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { InfoTip } from "@/components/dashboard/info-tip";
import { RISK_BAR, RiskBadge } from "@/components/dashboard/risk-badge";
import type { AiInsight, Priority } from "@/lib/ai/contract";
import { useNow } from "@/hooks/use-now";
import { formatShortDay, formatTime, qatarDay, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRIORITY: Record<Priority, { label: string; className: string }> = {
  high: { label: "High", className: "bg-risk-high-soft text-risk-high-ink ring-risk-high/25" },
  medium: { label: "Medium", className: "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40" },
  low: { label: "Low", className: "bg-muted text-muted-foreground ring-border" },
};

function marketSignal(note: string): { label: string; tone: "up" | "down" | "none" } {
  if (/oversupplied|glut/i.test(note)) return { label: "Oversupplied", tone: "down" };
  if (/undersupplied|short of|strong demand|import/i.test(note)) return { label: "In demand", tone: "up" };
  return { label: "No market signal", tone: "none" };
}

function Recommendation({
  index,
  title,
  detail,
  priority,
  defaultOpen,
}: {
  index: number;
  title: string;
  detail: string;
  priority: Priority;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const p = PRIORITY[priority];
  return (
    <li className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary tabular">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] leading-snug font-semibold">{title}</span>
        </span>
        <span className={cn("mt-px shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold uppercase ring-1 ring-inset", p.className)}>
          {p.label}
        </span>
        <ChevronDown
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && detail ? <p className="-mt-1 px-3 pb-3 pl-10.5 text-[13px] leading-relaxed text-muted-foreground">{detail}</p> : null}
    </li>
  );
}

/** The latest AI insight for a farm: risk, summary, prioritised actions and a crop suggestion. */
export function InsightPanel({ insight, farmName, className }: { insight: AiInsight | null; farmName: string; className?: string }) {
  const now = useNow();
  if (!insight) {
    return (
      <div className={cn("rounded-xl border border-dashed bg-card/60 p-5 text-center", className)}>
        <Sparkles className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium">No AI insight for {farmName} yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Insights appear here as soon as the model writes one to <code className="text-[12px]">ai_insights</code>. You can
          still ask the assistant below.
        </p>
      </div>
    );
  }

  const market = insight.crop_suggestion ? marketSignal(insight.crop_suggestion.market_note) : null;

  return (
    <div className={cn("space-y-4", className)}>
      <section aria-labelledby="risk-heading" className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <h3 id="risk-heading" className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
            Risk
          </h3>
          <InfoTip label="About the risk score">
            Risk score 0–100 from the AI insight model: predicted yield loss from salinity (Maas–Hoffman), the 30-day ECe
            trend and FAO-56 water stress (Ks). 70+ high, 40–69 medium, below 40 low.
          </InfoTip>
          <span
            className="ml-auto text-[11.5px] text-muted-foreground"
            title={`${formatShortDay(qatarDay(insight.created_at))}, ${formatTime(insight.created_at)} Qatar time`}
          >
            Updated {now ? relativeTime(insight.created_at, now) : `at ${formatTime(insight.created_at)}`}
          </span>
        </div>
        <div className="mt-2 flex items-end gap-3">
          <span className="font-display text-[40px] leading-none font-semibold tabular">{Math.round(insight.risk_score)}</span>
          <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
          <RiskBadge level={insight.risk_level} className="mb-0.5 ml-auto" />
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(insight.risk_score)}
          aria-label="Risk score"
        >
          <div className={cn("h-full rounded-full", RISK_BAR[insight.risk_level])} style={{ width: `${insight.risk_score}%` }} />
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-pretty">{insight.summary}</p>
      </section>

      {insight.recommendations.length > 0 ? (
        <section aria-labelledby="recs-heading">
          <h3 id="recs-heading" className="mb-2 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
            Recommended actions
          </h3>
          <ol className="space-y-1.5">
            {insight.recommendations.map((r, i) => (
              <Recommendation
                key={`${insight.id}-${i}`}
                index={i + 1}
                title={r.title}
                detail={r.detail}
                priority={r.priority}
                defaultOpen={i === 0}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {insight.crop_suggestion ? (
        <section aria-labelledby="crop-heading" className="rounded-xl border bg-accent/50 p-4">
          <div className="flex items-center gap-2">
            <h3 id="crop-heading" className="text-[12px] font-semibold tracking-wide text-accent-foreground/80 uppercase">
              Crop suggestion
            </h3>
            {market ? (
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                  market.tone === "up" && "bg-risk-low-soft text-risk-low-ink ring-risk-low/25",
                  market.tone === "down" && "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40",
                  market.tone === "none" && "bg-card text-muted-foreground ring-border",
                )}
              >
                {market.tone === "up" ? <TrendingUp className="size-3" aria-hidden="true" /> : null}
                {market.tone === "down" ? <TrendingDown className="size-3" aria-hidden="true" /> : null}
                {market.label}
              </span>
            ) : null}
          </div>
          <p className="mt-2 flex items-center gap-2 text-lg font-semibold">
            <Sprout className="size-5 text-primary" aria-hidden="true" />
            {insight.crop_suggestion.crop}
          </p>
          {insight.crop_suggestion.reason ? (
            <p className="mt-1 text-[13px] leading-relaxed text-pretty">{insight.crop_suggestion.reason}</p>
          ) : null}
          {insight.crop_suggestion.market_note ? (
            <p className="mt-2 border-t border-primary/10 pt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Market: </span>
              {insight.crop_suggestion.market_note}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
