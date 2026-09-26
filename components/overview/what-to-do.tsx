"use client";

/**
 * "What to do": the most urgent actions under the same priority headings as the Plan and the Advice
 * tab (titles only; the most urgent group with its one-line reasons), each with a tick and a link to
 * the action on the Advice tab, and the way to the full advice or the assistant. Sits beside the
 * farm's map, under the headline numbers it would otherwise repeat.
 */
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { DoneCheck, useActionTicks } from "@/components/insights/farm-advice";
import { RiskSparkline } from "@/components/insights/risk-sparkline";
import { actionFarm, PRIORITY_TONE, PRIORITY_WORD, riskReason, riskTrend, sortedActions, type FarmAction } from "@/lib/dashboard";
import { actionAnchor } from "@/lib/done-actions";
import { splitFirstSentence } from "@/lib/format";
import { assistantHref, farmTabHref } from "@/lib/routes";
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
  const ids = useId();
  const af = actionFarm(bundle);
  const actions: FarmAction[] = sortedActions(insight).map((rec) => ({ rec, farm: af }));
  const { left, remaining, isDone, tick } = useActionTicks(actions);
  const shown = left.slice(0, limit);
  // Consecutive runs of one priority (the actions are sorted by priority).
  const groups: Array<{ priority: FarmAction["rec"]["priority"]; items: FarmAction[] }> = [];
  for (const a of shown) {
    const last = groups.at(-1);
    if (last && last.priority === a.rec.priority) last.items.push(a);
    else groups.push({ priority: a.rec.priority, items: [a] });
  }
  const reason = riskReason(bundle);
  const trend = riskTrend(bundle.riskHistory);
  const top = left.find((a) => !isDone(a))?.rec;

  return (
    <section aria-labelledby="todo-title" className={cn("flex flex-col rounded-2xl border bg-card shadow-xs", className)}>
      <div className="flex-1 p-5">
        <h2 id="todo-title" className="text-base font-semibold">
          What to do
        </h2>
        {actions.length > 0 && left.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">All {actions.length} actions are done. New advice appears as the readings change.</p>
        ) : shown.length > 0 ? (
          <div className="mt-3 space-y-4" aria-label="Most urgent actions" role="group">
            {groups.map((g, gi) => (
              <div key={g.priority}>
                <h3 className="flex items-center gap-2 border-b pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <HealthDot tone={PRIORITY_TONE[g.priority]} className="ring-0" />
                  {PRIORITY_WORD[g.priority]}
                </h3>
                <ol className="mt-2.5 space-y-2.5">
                  {g.items.map((a, i) => {
                    const done = isDone(a);
                    const titleId = `${ids}-${gi}-${i}`;
                    return (
                      <li key={`${a.rec.title}-${i}`} className="flex items-start gap-3">
                        <DoneCheck done={done} onChange={(v) => tick(a, v)} labelledBy={titleId} className="-mt-3" />
                        {/* The title's link covers the text block, at least 44px tall on touch screens. */}
                        <div className="relative min-h-11 min-w-0 flex-1 lg:pointer-fine:min-h-0">
                          <Link
                            id={titleId}
                            href={`${farmTabHref(farm.id, "advice")}#${actionAnchor(a.rec.title)}`}
                            className={cn(
                              "block text-sm leading-snug font-semibold text-pretty after:absolute after:inset-0 after:rounded-sm hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/60",
                              done && "text-muted-foreground line-through decoration-muted-foreground/60",
                            )}
                          >
                            {a.rec.title}
                          </Link>
                          {gi === 0 && a.rec.detail && !done ? (
                            <p className="mt-0.5 text-sm leading-snug text-pretty text-muted-foreground">{splitFirstSentence(a.rec.detail)[0]}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
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
              {left.length > shown.length ? `All ${remaining} actions` : "Full advice"}
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
