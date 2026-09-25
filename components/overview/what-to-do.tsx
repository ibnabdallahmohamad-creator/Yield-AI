"use client";

/**
 * "What to do": the most urgent actions under the same priority headings as the Plan and the Advice
 * tab (titles only, the first with its one-line reason), and the way to the full advice or the
 * assistant. Sits beside the farm's map, under the headline numbers it would otherwise repeat.
 */
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { RiskSparkline } from "@/components/insights/risk-sparkline";
import { PRIORITY_TONE, PRIORITY_WORD, riskReason, riskTrend, sortedActions } from "@/lib/dashboard";
import { splitFirstSentence } from "@/lib/format";
import { assistantHref } from "@/lib/routes";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none lg:pointer-fine:min-h-9";

export function WhatToDo({
  bundle,
  limit = 3,
  onAllActions,
  className,
}: {
  bundle: FarmBundle;
  limit?: number;
  /** Opens the full advice (the farm's Advice tab). */
  onAllActions?: () => void;
  className?: string;
}) {
  const { farm, insight } = bundle;
  const actions = sortedActions(insight);
  const shown = actions.slice(0, limit);
  // Consecutive runs of one priority (the actions are sorted by priority).
  const groups: Array<{ priority: (typeof shown)[number]["priority"]; recs: typeof shown }> = [];
  for (const rec of shown) {
    const last = groups.at(-1);
    if (last && last.priority === rec.priority) last.recs.push(rec);
    else groups.push({ priority: rec.priority, recs: [rec] });
  }
  const reason = riskReason(bundle);
  const trend = riskTrend(bundle.riskHistory);
  const top = actions[0];

  return (
    <section aria-labelledby="todo-title" className={cn("flex flex-col rounded-2xl border bg-card shadow-xs", className)}>
      <div className="flex-1 p-5">
        <h2 id="todo-title" className="text-base font-semibold">
          What to do
        </h2>
        {shown.length > 0 ? (
          <div className="mt-3 space-y-4" aria-label="Most urgent actions" role="group">
            {groups.map((g, gi) => (
              <div key={g.priority}>
                <h3 className="flex items-center gap-2 border-b pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <HealthDot tone={PRIORITY_TONE[g.priority]} className="ring-0" />
                  {PRIORITY_WORD[g.priority]}
                </h3>
                <ol className="mt-2.5 space-y-2.5">
                  {g.recs.map((rec, i) => (
                    <li key={`${rec.title}-${i}`}>
                      <p className="text-sm leading-snug font-semibold text-pretty">{rec.title}</p>
                      {gi === 0 && i === 0 && rec.detail ? (
                        <p className="mt-0.5 text-sm leading-snug text-pretty text-muted-foreground">{splitFirstSentence(rec.detail)[0]}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No advice for {farm.name} yet. It appears here as soon as the model writes an assessment.</p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-5">
          {onAllActions ? (
            <button type="button" onClick={onAllActions} className={LINK}>
              {actions.length > 1 ? `All ${actions.length} actions` : "All advice"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <Link
            href={assistantHref(
              farm.id,
              top ? `Explain this recommendation and how to do it: ${top.title}` : `What should I do at ${farm.name} this week?`,
              top ? insight?.id : undefined,
            )}
            className={LINK}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Ask AI about this
          </Link>
        </div>
      </div>

      {bundle.riskHistory.length > 1 ? (
        <div className="flex items-center gap-4 border-t bg-muted/40 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground">Risk, last {bundle.riskHistory.length} days</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm">
              <HealthDot tone={reason.tone} className="ring-0" />
              <span className="font-semibold tabular">{insight ? Math.round(insight.risk_score) : "—"}</span>
              <span className="truncate text-muted-foreground">
                {trend ? (trend.word === "Steady" ? "· steady" : `· ${trend.word === "Rising" ? "up" : "down"} ${Math.abs(trend.change)}`) : null}
              </span>
            </p>
          </div>
          <RiskSparkline points={bundle.riskHistory} level={insight?.risk_level ?? null} width={132} height={36} />
        </div>
      ) : null}
    </section>
  );
}
