"use client";

/**
 * Four headline numbers (ui_improvement §7.1 item 4): salinity, yield at risk, soil moisture and the
 * next irrigation. Sub-lines are plain words; the formulas live on Farm details → Method.
 */
import { HealthDot } from "@/components/dashboard/risk-badge";
import { CROPS, ECE_CLASSES } from "@/lib/agronomy-tables";
import { irrigationPlan, type HealthTone } from "@/lib/dashboard";
import { fmtNum } from "@/lib/format";
import { computeDelta, METRICS, type Delta, type MetricKey } from "@/lib/metrics";
import type { FarmBundle, FarmDay } from "@/lib/types";
import { cn } from "@/lib/utils";

function DeltaText({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold tabular",
        delta.tone === "bad" ? "bg-risk-high-soft text-risk-high-ink" : "bg-muted text-muted-foreground",
      )}
      title="Change since the 'then' day"
    >
      {delta.text}
    </span>
  );
}

function Tile({
  label,
  value,
  unit,
  sub,
  tone,
  delta,
  flashKey,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  tone: HealthTone;
  delta?: Delta | null;
  flashKey?: number;
}) {
  return (
    <div key={flashKey} className={cn("flex min-w-0 flex-col rounded-2xl border bg-card px-4 py-3 shadow-xs sm:px-5 sm:py-4", flashKey ? "yai-flash" : undefined)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        <DeltaText delta={delta ?? null} />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[1.75rem] leading-tight font-semibold tracking-tight tabular">{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="mt-1 flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
        {tone !== "none" ? <HealthDot tone={tone} className="mt-[0.3rem] ring-0" /> : null}
        <span className="line-clamp-2 leading-snug">{sub}</span>
      </div>
    </div>
  );
}

function delta(key: MetricKey, then: FarmDay | null | undefined, now: FarmDay | null): Delta | null {
  if (!then || !now) return null;
  const metric = METRICS[key];
  return computeDelta(metric, metric.farmValue(then), metric.farmValue(now));
}

export function KpiRow({
  bundle,
  day,
  dates,
  index,
  thenDay,
  flashKey,
  className,
}: {
  bundle: FarmBundle;
  day: FarmDay | null;
  dates: string[];
  index: number;
  /** Compare mode: the "then" day, for change chips. */
  thenDay?: FarmDay | null;
  flashKey?: number;
  className?: string;
}) {
  const crop = CROPS[bundle.farm.main_crop];
  const limit = crop.salinity.threshold_dS_per_m;
  const d = day;
  const cropName = crop.name.toLowerCase();
  const noData = "No readings this day";

  const loss = d?.yieldLoss ?? null;
  const salinityClass = d?.salinityClass ? ECE_CLASSES.find((c) => c.id === d.salinityClass)?.label : null;
  const eceTone: HealthTone = d?.ece == null ? "none" : loss != null && loss >= 10 ? "bad" : d.ece >= limit * 0.85 ? "warn" : "ok";
  const lossTone: HealthTone = loss == null ? "none" : loss >= 10 ? "bad" : loss >= 2 ? "warn" : "ok";
  const waterTone: HealthTone = d?.deficitPct == null ? "none" : d.deficitPct > 100 ? "bad" : d.deficitPct >= 80 ? "warn" : "ok";
  const plan = irrigationPlan(d, dates, index);
  const planTone: HealthTone = plan.status === "now" ? "bad" : plan.status === "soon" ? "warn" : plan.status === "later" ? "ok" : "none";

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4", className)} role="group" aria-label="Headline numbers">
      <Tile
        label="Salinity"
        value={fmtNum(d?.ece, d?.ece != null && d.ece < 2 ? 2 : 1)}
        unit="dS/m"
        tone={eceTone}
        sub={d?.ece == null ? noData : d.ece > limit ? `Above ${cropName} limit` : (salinityClass ?? `Limit ${fmtNum(limit, 1)}`)}
        delta={delta("ece", thenDay, d)}
        flashKey={flashKey}
      />
      <Tile
        label="Yield at risk"
        value={loss == null ? "—" : fmtNum(loss, loss > 0 && loss < 10 ? 1 : 0)}
        unit="%"
        tone={lossTone}
        sub={loss == null ? noData : loss < 0.5 ? "None lost to salt" : "From salt"}
        delta={delta("yieldLoss", thenDay, d)}
        flashKey={flashKey}
      />
      <Tile
        label="Soil moisture"
        value={fmtNum(d?.moisture, 1)}
        unit="%"
        tone={waterTone}
        sub={
          d?.deficitPct == null
            ? noData
            : d.deficitPct > 100
              ? "Too dry: crop stressed"
              : d.deficitPct >= 80
                ? "Nearly due for water"
                : "Enough water"
        }
        delta={delta("moisture", thenDay, d)}
        flashKey={flashKey}
      />
      <Tile
        label="Next irrigation"
        value={plan.when}
        tone={planTone}
        sub={plan.grossMm == null ? noData : plan.leachMm != null && plan.leachMm >= 1 ? `${plan.grossMm} mm, incl. ${plan.leachMm} mm to flush salt` : `${plan.grossMm} mm`}
        flashKey={flashKey}
      />
    </div>
  );
}
