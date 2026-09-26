"use client";

/**
 * Four headline numbers (ui_improvement §7.1 item 4): salinity, yield at risk, soil moisture and the
 * next irrigation. Sub-lines are plain words; the formulas live on Farm details → Method. Each tile
 * has a small picture of where the number stands:
 * - salinity: two weeks against the crop's limit
 * - yield at risk: a meter
 * - moisture: where it sits between wilting point and field capacity
 * - next irrigation: the coming week
 */
import { HealthDot } from "@/components/dashboard/risk-badge";
import { CROPS, ECE_CLASSES } from "@/lib/agronomy-tables";
import { irrigationPlan, moistureLimitsPct, triggerMoisturePct, type HealthTone } from "@/lib/dashboard";
import { addDays } from "@/lib/data/time";
import { fmtNum, formatWeekday } from "@/lib/format";
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

const TONE_COLOR: Record<HealthTone, string> = {
  bad: "var(--risk-high)",
  warn: "var(--risk-medium)",
  ok: "var(--primary)",
  none: "var(--muted-foreground)",
};

/** Two weeks of a value, with a dashed limit line and a dot on today. */
function Sparkline({ values, limit, tone, label }: { values: Array<number | null>; limit?: number; tone: HealthTone; label: string }) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length < 2) return null;
  let lo = Math.min(...finite, limit ?? Infinity);
  let hi = Math.max(...finite, limit ?? -Infinity);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.02, 0.05);
  lo -= pad;
  hi += pad;
  const n = values.length;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 26 - ((v - lo) / (hi - lo)) * 24;
  const pts = values.flatMap((v, i) => (v != null && Number.isFinite(v) ? [`${x(i).toFixed(2)},${y(v).toFixed(2)}`] : []));
  const lastI = values.findLastIndex((v) => v != null && Number.isFinite(v));
  const last = values[lastI]!;
  return (
    <div className="relative mt-2 h-7" role="img" aria-label={label}>
      <svg className="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        {limit != null ? <line x1={0} x2={100} y1={y(limit)} y2={y(limit)} stroke="var(--risk-high)" strokeOpacity={0.7} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
        <path d={`M${pts[0].split(",")[0]},28 L${pts.join(" L")} L${x(lastI).toFixed(2)},28 Z`} fill={TONE_COLOR[tone]} fillOpacity={0.1} />
        <path d={`M${pts.join(" L")}`} fill="none" stroke={TONE_COLOR[tone]} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute size-2 -translate-1/2 rounded-full ring-2 ring-card"
        style={{ left: `${x(lastI)}%`, top: `${(y(last) / 28) * 100}%`, background: TONE_COLOR[tone] }}
        aria-hidden="true"
      />
    </div>
  );
}

/** A horizontal meter with labelled ticks (a scale under the bar). */
function Meter({ value, max, ticks, tone, label }: { value: number; max: number; ticks: Array<{ at: number; text: string }>; tone: HealthTone; label: string }) {
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div className="mt-2" role="img" aria-label={label}>
      <div className="relative h-2 rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pos(value), background: TONE_COLOR[tone] }} />
        {ticks.map((t) => (
          <span key={t.at} className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/45" style={{ left: pos(t.at) }} aria-hidden="true" />
        ))}
      </div>
      <div className="relative mt-0.5 h-4 text-xs text-muted-foreground" aria-hidden="true">
        {ticks.map((t) => (
          // The end labels sit inside the bar's ends so "100%" never runs past the tile.
          <span
            key={t.at}
            className={cn("absolute whitespace-nowrap tabular", t.at >= max ? "-translate-x-full" : t.at <= 0 ? "" : "-translate-x-1/2")}
            style={{ left: pos(t.at) }}
          >
            {t.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Wilting point → field capacity, split at the irrigation trigger, with today's moisture marked. */
function WaterGauge({ value, wp, trigger, fc, label }: { value: number; wp: number; trigger: number | null; fc: number; label: string }) {
  const lo = wp;
  const hi = fc;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const t = trigger != null ? pos(trigger) : null;
  return (
    <div className="mt-2" role="img" aria-label={label}>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        {t != null ? (
          <>
            <div className="absolute inset-y-0 left-0 bg-risk-medium/45" style={{ width: `${t}%` }} />
            <div className="absolute inset-y-0 right-0 bg-risk-low/45" style={{ left: `${t}%` }} />
          </>
        ) : null}
      </div>
      <div className="relative -mt-3 h-4" aria-hidden="true">
        <span className="absolute top-0.5 h-3 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card" style={{ left: `${pos(value)}%` }} />
      </div>
      <div className="relative h-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="absolute left-0">Wilting</span>
        {/* At the trigger, kept clear of the end labels. */}
        {t != null ? (
          <span className="absolute -translate-x-1/2" style={{ left: `${Math.min(64, Math.max(40, t))}%` }}>
            Irrigate
          </span>
        ) : null}
        <span className="absolute right-0">Full</span>
      </div>
    </div>
  );
}

/** The coming week, today first, with the irrigation day filled. */
function WeekStrip({ start, inDays, label }: { start: string; inDays: number | null; label: string }) {
  const due = inDays == null ? null : Math.max(0, Math.round(inDays));
  return (
    <ol className="mt-2 grid grid-cols-7 gap-0.5 sm:gap-1" aria-label={label}>
      {Array.from({ length: 7 }, (_, k) => {
        const date = addDays(start, k);
        const isDue = due === k;
        return (
          <li
            key={date}
            className={cn(
              "flex h-7 items-center justify-center rounded-md text-xs font-medium",
              isDue ? "bg-[oklch(0.56_0.11_240)] font-semibold text-white" : "bg-muted text-muted-foreground",
              k === 0 && !isDue && "ring-1 ring-foreground/25 ring-inset",
            )}
            aria-current={k === 0 ? "date" : undefined}
          >
            {formatWeekday(date).slice(0, 2)}
          </li>
        );
      })}
    </ol>
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
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  tone: HealthTone;
  delta?: Delta | null;
  flashKey?: number;
  children?: React.ReactNode;
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
      <div className="mt-auto">{children}</div>
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
  const recent = bundle.days.slice(Math.max(0, index - 13), index + 1).map((x) => x?.ece ?? null);
  const limits = moistureLimitsPct(bundle.farm);
  const trigger = d ? triggerMoisturePct(bundle.farm, d) : null;

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
      >
        <Sparkline values={recent} limit={limit} tone={eceTone} label={`Salinity over the last ${recent.length} days against the ${cropName} limit of ${fmtNum(limit, 1)} dS/m`} />
      </Tile>
      <Tile
        label="Yield at risk"
        value={loss == null ? "—" : fmtNum(loss, loss > 0 && loss < 10 ? 1 : 0)}
        unit="%"
        tone={lossTone}
        sub={loss == null ? noData : loss < 0.5 ? "None lost to salt" : "From salt"}
        delta={delta("yieldLoss", thenDay, d)}
        flashKey={flashKey}
      >
        {loss != null ? (
          <Meter
            value={loss}
            max={100}
            tone={lossTone}
            ticks={[
              { at: 0, text: "" },
              { at: 10, text: "10" },
              { at: 50, text: "50" },
              { at: 100, text: "100%" },
            ]}
            label={`${fmtNum(loss, 0)}% of the yield at risk from salt`}
          />
        ) : null}
      </Tile>
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
      >
        {d?.moisture != null ? (
          <WaterGauge
            value={d.moisture}
            wp={limits.wp}
            fc={limits.fc}
            trigger={trigger}
            label={`Soil moisture ${fmtNum(d.moisture, 1)}%, between the wilting point ${fmtNum(limits.wp, 0)}% and field capacity ${fmtNum(limits.fc, 0)}%${trigger != null ? `; irrigate below ${fmtNum(trigger, 1)}%` : ""}`}
          />
        ) : null}
      </Tile>
      <Tile
        label="Next irrigation"
        value={plan.when}
        tone={planTone}
        sub={plan.grossMm == null ? noData : plan.leachMm != null && plan.leachMm >= 1 ? `${plan.grossMm} mm, incl. ${plan.leachMm} mm to flush salt` : `${plan.grossMm} mm`}
        flashKey={flashKey}
      >
        {plan.inDays != null && dates[index] ? <WeekStrip start={dates[index]} inDays={plan.inDays} label={`Irrigation due ${plan.when}`} /> : null}
      </Tile>
    </div>
  );
}
