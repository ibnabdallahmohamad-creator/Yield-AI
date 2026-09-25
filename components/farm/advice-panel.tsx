"use client";

/**
 * Farm → Advice: the farm's full assessment (every action with its Why, next season's crop) and the
 * report sections — warnings, findings, the next 7 days, economics, harvest — beside the risk trend
 * and the farm's location.
 */
import { ArrowRight, ListChecks, Sparkles } from "lucide-react";
import Link from "next/link";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { FarmAdvice } from "@/components/insights/farm-advice";
import { LocationCard, ReportSections } from "@/components/insights/report-sections";
import { RiskSparkline } from "@/components/insights/risk-sparkline";
import { actionFarm, cropChoice, plainHeadline, riskReason, riskTrend } from "@/lib/dashboard";
import { formatShortDay } from "@/lib/format";
import type { QatarLocation } from "@/lib/qatar/location";
import { assistantHref } from "@/lib/routes";
import type { FarmBundle } from "@/lib/types";

const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";
const LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-8 sm:pointer-coarse:min-h-11";

export function AdvicePanel({ bundle, location }: { bundle: FarmBundle; location: QatarLocation }) {
  const { farm, insight } = bundle;
  const reason = riskReason(bundle);
  const trend = riskTrend(bundle.riskHistory);
  const trendText = trend ? (trend.word === "Steady" ? `Steady over ${trend.days} days` : `${trend.word === "Rising" ? "Up" : "Down"} ${Math.abs(trend.change)} in ${trend.days} days`) : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid grid-cols-1 gap-4 lg:gap-6">
        <FarmAdvice farm={actionFarm(bundle)} insight={insight} choice={cropChoice(bundle)} title="Assessment" showCrop={!insight?.harvest} />
        {insight ? <ReportSections insight={insight} /> : null}
      </div>

      <aside aria-label="Risk and next steps" className="grid gap-4 sm:grid-cols-2 lg:gap-6 xl:sticky xl:top-[7.5rem] xl:grid-cols-1">
        <section aria-labelledby="trend-heading" className={CARD}>
          <h2 id="trend-heading" className="text-base font-semibold">
            Risk trend
          </h2>
          <p className="mt-1 flex items-start gap-1.5 text-sm leading-snug text-muted-foreground">
            <HealthDot tone={reason.tone} className="mt-[0.3rem] ring-0" />
            <span className="min-w-0">
              {reason.label}
              {trendText ? <span className="whitespace-nowrap"> · {trendText}</span> : null}
            </span>
          </p>
          <RiskSparkline points={bundle.riskHistory} level={insight?.risk_level ?? null} width={280} height={72} className="mt-4 h-auto w-full" />
          {bundle.riskHistory.length > 1 ? (
            <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular">
              <span>{formatShortDay(bundle.riskHistory[0].date)}</span>
              <span>Today</span>
            </div>
          ) : null}
          <p className="mt-3 text-sm leading-relaxed text-pretty text-muted-foreground">{plainHeadline(bundle)}</p>
        </section>
        <LocationCard farmId={farm.id} location={location} />
        <section aria-labelledby="next-heading" className={CARD}>
          <h2 id="next-heading" className="text-base font-semibold">
            Go further
          </h2>
          <div className="mt-2 flex flex-col items-start">
            <Link href={assistantHref(farm.id, `Walk me through this week's plan for ${farm.name}.`, insight?.id)} className={LINK}>
              <Sparkles className="size-4" aria-hidden="true" />
              Ask AI to plan the week
            </Link>
            <Link href="/dashboard/insights" className={LINK}>
              <ListChecks className="size-4" aria-hidden="true" />
              This week across all farms
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
