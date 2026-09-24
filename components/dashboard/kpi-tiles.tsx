"use client";

import { InfoTip } from "@/components/dashboard/info-tip";
import { GROWTH_STAGE_LABEL } from "@/lib/agronomy";
import { CROPS } from "@/lib/agronomy-tables";
import { ECE_CLASSES } from "@/lib/agronomy-tables";
import { fmtNum } from "@/lib/format";
import { computeDelta, METRICS, type Delta, type MetricKey } from "@/lib/metrics";
import type { FarmBundle, FarmDay } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad" | "neutral";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-risk-low",
  warn: "bg-risk-medium",
  bad: "bg-risk-high",
  neutral: "bg-muted-foreground/40",
};

function DeltaChip({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-bold tabular",
        delta.tone === "bad" && "bg-risk-high-soft text-risk-high-ink",
        delta.tone === "good" && "bg-risk-low-soft text-risk-low-ink",
        delta.tone === "neutral" && "bg-muted text-muted-foreground",
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
  tone = "neutral",
  info,
  delta,
  flashKey,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: React.ReactNode;
  tone?: Tone;
  info: React.ReactNode;
  delta?: Delta | null;
  flashKey?: number;
}) {
  return (
    <div
      key={flashKey}
      className={cn("flex min-w-0 flex-col rounded-xl border bg-card px-3 py-2.5 shadow-xs", flashKey ? "yai-flash" : undefined)}
    >
      <div className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        <InfoTip label={`How ${label} is calculated`}>{info}</InfoTip>
        <DeltaChip delta={delta ?? null} />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] leading-none font-semibold tracking-tight tabular">{value}</span>
        {unit ? <span className="text-[12px] font-medium text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="mt-1.5 flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
        {tone !== "neutral" ? (
          <span className={cn("mt-[0.4em] size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden="true" />
        ) : null}
        <span className="line-clamp-2">{sub}</span>
      </div>
    </div>
  );
}

function delta(key: MetricKey, then: FarmDay | null | undefined, now: FarmDay | null): Delta | null {
  if (!then || !now) return null;
  const metric = METRICS[key];
  return computeDelta(metric, metric.farmValue(then), metric.farmValue(now));
}

/** Headline numbers for one farm and day — each with its unit and the method behind it. */
export function KpiTiles({
  bundle,
  day,
  thenDay,
  flashKey,
  className,
}: {
  bundle: FarmBundle;
  day: FarmDay | null;
  /** Compare mode: the "then" day, for delta chips. */
  thenDay?: FarmDay | null;
  flashKey?: number;
  className?: string;
}) {
  const { farm } = bundle;
  const crop = CROPS[farm.main_crop];
  const t = crop.salinity.threshold_dS_per_m;
  const d = day;
  const noData = "No readings on this day";

  const eceTone: Tone =
    d?.yieldLoss == null ? "neutral" : d.yieldLoss >= 10 ? "bad" : d.yieldLoss > 0.5 || (d.ece ?? 0) >= t ? "warn" : "ok";
  const lossTone: Tone = d?.yieldLoss == null ? "neutral" : d.yieldLoss >= 25 ? "bad" : d.yieldLoss >= 10 ? "warn" : "ok";
  const waterTone: Tone =
    d?.deficitPct == null ? "neutral" : d.deficitPct > 100 ? "bad" : d.deficitPct >= 80 ? "warn" : "ok";
  const salinityLabel = d?.salinityClass ? ECE_CLASSES.find((c) => c.id === d.salinityClass)?.label : null;

  const irrigationValue =
    d?.daysToIrrigation == null ? "—" : d.daysToIrrigation <= 0.05 ? "Now" : fmtNum(d.daysToIrrigation, 1);

  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6", className)}>
      <Tile
        label="Salinity (ECe, est.)"
        value={fmtNum(d?.ece, d?.ece != null && d.ece < 2 ? 2 : 1)}
        unit="dS/m"
        tone={eceTone}
        sub={d ? (salinityLabel ?? "—") : noData}
        delta={delta("ece", thenDay, d)}
        flashKey={flashKey}
        info={
          <>
            Estimated ECe = probe bulk EC ({fmtNum(d?.ec, 2)} dS/m) × this farm&apos;s calibration factor{" "}
            {fmtNum(farm.ec_calibration_factor, 2)}, fit from paired lab saturated-paste samples. Classes: FAO/USDA
            (&lt;2 non-saline, 2–4, 4–8, 8–16, &gt;16 dS/m).
          </>
        }
      />
      <Tile
        label="Predicted yield loss"
        value={d?.yieldLoss == null ? "—" : fmtNum(d.yieldLoss, d.yieldLoss < 10 && d.yieldLoss > 0 ? 1 : 0)}
        unit="%"
        tone={lossTone}
        sub={`${crop.name} tolerates ${fmtNum(t, 1)} dS/m`}
        delta={delta("yieldLoss", thenDay, d)}
        flashKey={flashKey}
        info={
          <>
            Maas–Hoffman salt-tolerance model: loss = b × (ECe − threshold) above the threshold. {crop.name}: threshold{" "}
            {fmtNum(t, 1)} dS/m, slope b = {fmtNum(crop.salinity.slope_pct_per_dS_per_m, 1)} % per dS/m ({crop.salinity.source}).
          </>
        }
      />
      <Tile
        label="Soil moisture"
        value={fmtNum(d?.moisture, 1)}
        unit="% VWC"
        tone={waterTone}
        sub={d?.deficitPct != null ? `Deficit ${fmtNum(d.deficitPct, 0)}% of RAW` : d ? "—" : noData}
        delta={delta("moisture", thenDay, d)}
        flashKey={flashKey}
        info={
          <>
            Probe volumetric water content. Deficit = root-zone depletion Dr = 1000 (θFC − θ) Zr as a share of readily
            available water RAW = p × TAW (FAO-56 Eq. 82–87). Zr {fmtNum(d?.rootDepth, 2)} m, TAW {fmtNum(d?.taw, 0)} mm, RAW{" "}
            {fmtNum(d?.raw, 0)} mm. 100% = irrigate.
          </>
        }
      />
      <Tile
        label="Reference ET₀"
        value={fmtNum(d?.et0, 1)}
        unit="mm/day"
        sub={
          d?.et0 == null
            ? d
              ? "—"
              : noData
            : d.et0Method === "hargreaves"
              ? "estimated (Hargreaves)"
              : `Penman–Monteith · Open-Meteo ${fmtNum(d.et0OpenMeteo, 1)}`
        }
        delta={delta("et0", thenDay, d)}
        flashKey={flashKey}
        info={
          <>
            {d?.et0Method === "hargreaves"
              ? "Estimated with FAO-56 Hargreaves (Eq. 52) because a Penman–Monteith input was missing."
              : "FAO-56 Penman–Monteith (Eq. 6), daily: air Tmax/Tmin and RH from " +
                (d?.airSource === "probe" ? "the probe mast" : "Open-Meteo") +
                ", wind (10 m → 2 m, Eq. 47) and solar radiation from Open-Meteo."}{" "}
            Open-Meteo&apos;s own FAO ET₀ ({fmtNum(d?.et0OpenMeteo, 1)} mm/day) is shown as a cross-check.
          </>
        }
      />
      <Tile
        label="Crop water use ETc"
        value={fmtNum(d?.etc, 1)}
        unit="mm/day"
        sub={d?.kc != null ? `Kc ${fmtNum(d.kc, 2)} · ${GROWTH_STAGE_LABEL[d.stage].toLowerCase()}` : d ? "—" : noData}
        delta={delta("etc", thenDay, d)}
        flashKey={flashKey}
        info={
          <>
            ETc = Kc × ET₀ (FAO-56 Eq. 56). {crop.name} Kc {crop.kc.ini}/{crop.kc.mid}/{crop.kc.end} by growth stage (
            {crop.kcSource}), mid and end adjusted for local wind and humidity (Eq. 62, 65). Day {d?.dap ?? "—"} after planting.
          </>
        }
      />
      <Tile
        label="Next irrigation"
        value={irrigationValue}
        unit={irrigationValue === "Now" || irrigationValue === "—" ? undefined : "days"}
        tone={d?.daysToIrrigation == null ? "neutral" : d.daysToIrrigation <= 0.05 ? "bad" : d.daysToIrrigation < 1 ? "warn" : "ok"}
        sub={
          d?.netDepth != null
            ? `${fmtNum(d.netDepth, 0)} mm net · ${fmtNum(d.grossDepth, 0)} mm with leaching`
            : d
              ? "—"
              : noData
        }
        flashKey={flashKey}
        info={
          <>
            Days until depletion reaches RAW = (RAW − Dr) / ETc. Net depth = Dr (refill to field capacity, FAO-56). Gross depth =
            net / (1 − LR), LR = ECw / (5 ECe − ECw) = {fmtNum((d?.lr ?? 0) * 100, 0)}% (FAO-29 Eq. 7–8) with ECw{" "}
            {fmtNum(farm.irrigation_water_ec, 1)} dS/m and target ECe {fmtNum(d?.eceTarget, 1)} dS/m (90% yield).
          </>
        }
      />
    </div>
  );
}
