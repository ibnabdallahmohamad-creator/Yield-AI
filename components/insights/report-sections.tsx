/**
 * The report sections of one farm's insight: Warnings, Insights, Next 7 days, Economic analysis
 * and Harvest & next crop, plus the farm's exact location. Server-rendered; every number comes
 * from the stored insight (rules engine or model), which is grounded in lib/ai/farm-facts.ts.
 */
import { ArrowRight, CalendarDays, Coins, Lightbulb, MapPin, Sprout, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { HealthDot } from "@/components/dashboard/risk-badge";
import type { AiInsight, ForecastDay, WarningSeverity } from "@/lib/ai/contract";
import type { HealthTone } from "@/lib/dashboard";
import { formatDay } from "@/lib/format";
import type { QatarLocation } from "@/lib/qatar/location";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";
const H2 = "flex items-center gap-2 text-base font-semibold";
const LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-8 sm:pointer-coarse:min-h-11";

const SEVERITY: Record<WarningSeverity, { word: string; tone: HealthTone }> = {
  critical: { word: "Act now", tone: "bad" },
  warning: { word: "Warning", tone: "warn" },
  watch: { word: "Watch", tone: "none" },
};

const DAY_TONE: Record<ForecastDay["level"], HealthTone> = { warning: "warn", watch: "none", ok: "ok" };
const DAY_WORD: Record<ForecastDay["level"], string> = { warning: "Warning", watch: "Watch", ok: "Fine" };

export function WarningsCard({ warnings, className }: { warnings: AiInsight["warnings"]; className?: string }) {
  return (
    <section aria-labelledby="warnings-heading" className={cn(CARD, className)}>
      <h2 id="warnings-heading" className={H2}>
        <TriangleAlert className="size-4 text-muted-foreground" aria-hidden="true" />
        Warnings
      </h2>
      {warnings.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing ahead in the next 7 days needs attention.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {warnings.map((w, i) => (
            <li key={`${i}-${w.title}`} className="py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <HealthDot tone={SEVERITY[w.severity].tone} className="ring-0" />
                {SEVERITY[w.severity].word}
                {w.when ? <span className="font-medium tracking-normal normal-case">· {w.when}</span> : null}
              </p>
              <p className="mt-1 text-base leading-snug font-semibold text-pretty">{w.title}</p>
              {w.detail ? <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{w.detail}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FindingsCard({ insights, className }: { insights: AiInsight["insights"]; className?: string }) {
  if (insights.length === 0) return null;
  return (
    <section aria-labelledby="findings-heading" className={cn(CARD, className)}>
      <h2 id="findings-heading" className={H2}>
        <Lightbulb className="size-4 text-muted-foreground" aria-hidden="true" />
        Insights
      </h2>
      <ul className="mt-3 space-y-4">
        {insights.map((f, i) => (
          <li key={`${i}-${f.title}`}>
            <p className="text-sm leading-snug font-semibold text-pretty">{f.title}</p>
            {f.detail ? <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{f.detail}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ForecastCard({ forecast, className }: { forecast: AiInsight["forecast"]; className?: string }) {
  if (!forecast) return null;
  return (
    <section aria-labelledby="forecast-heading" className={cn(CARD, className)}>
      <h2 id="forecast-heading" className={H2}>
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
        Next 7 days
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">{forecast.summary}</p>
      {forecast.days.length > 0 ? (
        <ol aria-label="Day by day" className="mt-3 divide-y">
          {forecast.days.map((d) => (
            <li key={d.date} className="flex items-start gap-3 py-2">
              <span className="w-24 shrink-0 text-sm font-semibold tabular">{formatDay(d.date)}</span>
              <HealthDot tone={DAY_TONE[d.level]} label={DAY_WORD[d.level]} className="mt-1.5 ring-0" />
              <span className="min-w-0 text-sm text-pretty text-muted-foreground">{d.label || "No action"}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function EconomicsCard({ economics, className }: { economics: AiInsight["economics"]; className?: string }) {
  if (!economics) return null;
  return (
    <section aria-labelledby="economics-heading" className={cn(CARD, className)}>
      <h2 id="economics-heading" className={H2}>
        <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
        Economic analysis
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">{economics.summary}</p>
      {economics.lines.length > 0 ? (
        <dl className="mt-3 divide-y">
          {economics.lines.map((l, i) => (
            <div key={`${i}-${l.label}`} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
              <dt className="text-sm text-muted-foreground">{l.label}</dt>
              <dd className="min-w-0">
                <span className="text-sm font-semibold tabular">{l.value}</span>
                {l.detail ? <span className="block text-sm leading-relaxed text-pretty text-muted-foreground">{l.detail}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {economics.assumptions.length > 0 ? (
        <ul aria-label="Assumptions" className="mt-3 list-disc space-y-1 border-t pt-3 pl-4 text-xs leading-relaxed text-muted-foreground">
          {economics.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function HarvestCard({ harvest, className }: { harvest: AiInsight["harvest"]; className?: string }) {
  if (!harvest) return null;
  const window = harvest.window;
  return (
    <section aria-labelledby="harvest-heading" className={cn(CARD, className)}>
      <h2 id="harvest-heading" className={H2}>
        <Sprout className="size-4 text-muted-foreground" aria-hidden="true" />
        Harvest &amp; next crop
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty">{harvest.summary}</p>
      {window && harvest.status !== "cutting" && harvest.status !== "establishing" ? (
        <p className="mt-1 text-sm text-muted-foreground tabular">
          Harvest window: {formatDay(window.start)}
          {window.end ? ` – ${formatDay(window.end)}` : ""}
        </p>
      ) : null}
      {harvest.next_crops.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-muted-foreground">Best next crops</h3>
          <ol className="mt-2 space-y-3">
            {harvest.next_crops.map((c, i) => (
              <li key={c.crop} className="flex gap-3">
                <span className="w-5 shrink-0 text-sm font-semibold text-muted-foreground tabular">{i + 1}.</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {c.crop}
                    {c.plant_window ? <span className="font-normal text-muted-foreground"> · plant {c.plant_window}</span> : null}
                  </p>
                  {c.reason ? <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">{c.reason}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;

/** Exact position and what it means in Qatar (coast, groundwater basin), with the land-use hand-off. */
export function LocationCard({ farmId, location, className }: { farmId: string; location: QatarLocation; className?: string }) {
  const ec = location.typical_groundwater_ec_dS_m;
  return (
    <section aria-labelledby="location-heading" className={cn(CARD, className)}>
      <h2 id="location-heading" className={H2}>
        <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
        Location
      </h2>
      <p className="mt-2 text-sm font-semibold tabular">
        {coord(location.lat, "N", "S")}, {coord(location.lng, "E", "W")}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Place</dt>
          <dd className="min-w-0">
            {location.place} · {location.municipality}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Sea</dt>
          <dd className="tabular">
            {location.distance_to_coast_km.toFixed(1)} km ({location.coast_band.replace("-", " ")})
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Groundwater</dt>
          <dd className="min-w-0 tabular">
            {location.groundwater_basin === "northern" ? "Northern" : "Southern"} basin, typically ECw {ec.low.toFixed(1)}–{ec.high.toFixed(1)} dS/m
          </dd>
        </div>
      </dl>
      <Link href={`/dashboard/land?farm=${encodeURIComponent(farmId)}`} className={cn(LINK, "mt-2")}>
        What else could this land grow?
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

/** The report sections in reading order. */
export function ReportSections({ insight }: { insight: AiInsight }) {
  const hasAny = insight.warnings.length || insight.insights.length || insight.forecast || insight.economics || insight.harvest;
  if (!hasAny) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-6">
      <WarningsCard warnings={insight.warnings} />
      <FindingsCard insights={insight.insights} />
      <ForecastCard forecast={insight.forecast} />
      <EconomicsCard economics={insight.economics} />
      <HarvestCard harvest={insight.harvest} />
    </div>
  );
}
