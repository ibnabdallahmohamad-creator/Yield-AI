"use client";

/**
 * Farm → Advice: the farm's full assessment (every action with its Why, next season's crop) and the
 * report sections — warnings, findings, the next 7 days, economics, harvest — beside the risk trend
 * and the farm's location.
 */
import { HealthDot } from "@/components/dashboard/risk-badge";
import { FarmAdvice } from "@/components/insights/farm-advice";
import { LocationCard, ReportSections } from "@/components/insights/report-sections";
import { RiskTrendChart } from "@/components/insights/risk-trend-chart";
import { actionFarm, cropChoice, plainHeadline, riskReason, riskTrend } from "@/lib/dashboard";
import type { QatarLocation } from "@/lib/qatar/location";
import type { FarmBundle } from "@/lib/types";

const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";

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
          <RiskTrendChart points={bundle.riskHistory} level={insight?.risk_level ?? null} className="mt-4" />
          <p className="mt-3 text-sm leading-relaxed text-pretty text-muted-foreground">{plainHeadline(bundle)}</p>
        </section>
        <LocationCard farmId={farm.id} location={location} />
      </aside>
    </div>
  );
}
