"use client";

/**
 * The land-use report: the best use and why, every option ranked with its factors, current news
 * and markets (live research or the built-in reference), the site and its climate, and the national
 * food-security goals the options serve.
 */
import { ExternalLink, Globe, MapPin, Newspaper, Target, ThermometerSun, Trophy } from "lucide-react";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { HealthTone } from "@/lib/dashboard";
import { formatDay, formatTime, qatarDay } from "@/lib/format";
import type { FactorKey, LandReport, LandResearch, RankedOption } from "@/lib/land/contract";
import { WATER_SOURCE_LABEL } from "@/lib/land/options";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";
const H2 = "flex items-center gap-2 text-base font-semibold";
const LINK =
  "inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-0";

const FIT: Record<RankedOption["fit"], { word: string; tone: HealthTone }> = {
  strong: { word: "Strong fit", tone: "ok" },
  possible: { word: "Possible", tone: "warn" },
  poor: { word: "Weak fit", tone: "bad" },
};

const FACTOR_LABEL: Record<FactorKey, string> = {
  water: "Water",
  goal: "National goal",
  market: "Market",
  budget: "Budget",
  policy: "Water policy",
  site: "Site and climate",
};

const SIGNAL: Record<LandResearch["highlights"][number]["signal"], { word: string; tone: HealthTone }> = {
  opportunity: { word: "Opportunity", tone: "ok" },
  risk: { word: "Risk", tone: "warn" },
  neutral: { word: "Context", tone: "none" },
};

const MONTH_INITIAL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const thousands = (v: number) => Math.round(v).toLocaleString("en-US");
const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;

function fitWord(o: RankedOption) {
  return o.blocked ? "Not suitable" : FIT[o.fit].word;
}

function ScoreBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden="true">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

function SourceLinks({ sources }: { sources: Array<{ title: string; url: string }> }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col items-start gap-x-4 sm:flex-row sm:flex-wrap">
      {sources.map((s) => (
        <li key={s.url} className="min-w-0 max-w-full">
          <a href={s.url} target="_blank" rel="noreferrer" className={cn(LINK, "max-w-full")}>
            <span className="truncate">{s.title}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function BestUse({ report }: { report: LandReport }) {
  const best = report.options.find((o) => !o.blocked) ?? report.options[0];
  const runnerUp = report.options.filter((o) => o.id !== best.id && !o.blocked).slice(0, 2);
  return (
    <section aria-labelledby="best-heading" className={CARD}>
      <h2 id="best-heading" className={H2}>
        <Trophy className="size-4 text-muted-foreground" aria-hidden="true" />
        Best use for this land
      </h2>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xl font-semibold tracking-tight">{best.name}</p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground tabular">
          <HealthDot tone={FIT[best.fit].tone} className="ring-0" />
          {fitWord(best)} · {best.score}/100
        </p>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{best.summary}</p>
      {report.research.status === "live" && report.research.advice ? (
        <p className="mt-3 border-l-2 border-primary/40 pl-3 text-base leading-relaxed text-pretty">{report.research.advice}</p>
      ) : null}
      {best.why.length ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-muted-foreground">Why</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
            {best.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {best.research_note ? <li>{best.research_note}</li> : null}
          </ul>
        </>
      ) : null}
      <h3 className="mt-4 text-sm font-semibold text-muted-foreground">First steps</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
        {best.first_steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {runnerUp.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Also worth a look: {runnerUp.map((o) => `${o.name} (${o.score})`).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}

function OptionDetails({ option, areaHa }: { option: RankedOption; areaHa: number }) {
  return (
    <div className="space-y-4">
      {option.blocked ? <p className="text-sm text-destructive">{option.blocked}</p> : null}
      <dl className="divide-y">
        {(Object.keys(FACTOR_LABEL) as FactorKey[]).map((k) => (
          <div key={k} className="grid grid-cols-1 gap-x-4 gap-y-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-sm font-medium">
              {FACTOR_LABEL[k]}
              <ScoreBar value={option.factors[k].score * 100} className="mt-1.5 max-w-32" />
            </dt>
            <dd className="text-sm leading-relaxed text-pretty text-muted-foreground">{option.factors[k].label}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Set-up cost</dt>
          <dd className="font-medium capitalize">{option.capex}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">First income</dt>
          <dd className="font-medium">{option.first_income}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Water a year</dt>
          <dd className="font-medium tabular">
            {option.water_m3_yr != null ? `${thousands(option.water_m3_yr)} m³ for ${areaHa} ha` : "Drinking and cooling only"}
          </dd>
        </div>
      </dl>
      {option.research_note ? (
        <p className="text-sm leading-relaxed text-pretty">
          <span className="font-semibold">News and markets ({option.research_delta > 0 ? "+" : ""}{option.research_delta}): </span>
          {option.research_note}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground">Risks</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
            {option.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground">First steps</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
            {option.first_steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Options({ report }: { report: LandReport }) {
  return (
    <section aria-labelledby="options-heading" className={CARD}>
      <h2 id="options-heading" className={H2}>
        All options, best first
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Scored 0–100 for {report.area_ha} ha on {WATER_SOURCE_LABEL[report.water.source].toLowerCase()} with a {report.budget} budget.
      </p>
      <Accordion type="single" collapsible className="mt-2">
        {report.options.map((o, i) => (
          <AccordionItem key={o.id} value={o.id}>
            <AccordionTrigger className="items-start gap-3 text-base">
              <span className="flex min-w-0 flex-1 items-start gap-3">
                <span className="w-5 shrink-0 text-sm font-semibold text-muted-foreground tabular">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>{o.name}</span>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground tabular">
                      <HealthDot tone={o.blocked ? "bad" : FIT[o.fit].tone} className="ring-0" />
                      {fitWord(o)} · {o.score}
                    </span>
                  </span>
                  <ScoreBar value={o.score} className="mt-2" />
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pl-8">
              <OptionDetails option={o} areaHa={report.area_ha} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function Research({ research }: { research: LandResearch }) {
  const status =
    research.status === "live"
      ? `Live search${research.searched_at ? ` · ${formatDay(qatarDay(research.searched_at))}, ${formatTime(research.searched_at)}` : ""}`
      : research.status === "failed"
        ? "Live search unavailable · built-in reference"
        : "Built-in Qatar reference";
  return (
    <section aria-labelledby="research-heading" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="research-heading" className={H2}>
          <Newspaper className="size-4 text-muted-foreground" aria-hidden="true" />
          News and markets
        </h2>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="size-3.5" aria-hidden="true" />
          {status}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-pretty">{research.headline}</p>
      {research.highlights.length ? (
        <ul className="mt-3 divide-y">
          {research.highlights.map((h) => (
            <li key={h.title} className="py-3 first:pt-0 last:pb-0">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <HealthDot tone={SIGNAL[h.signal].tone} className="ring-0" />
                {SIGNAL[h.signal].word}
              </p>
              <p className="mt-1 text-sm font-semibold text-pretty">{h.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">{h.detail}</p>
              <SourceLinks sources={h.sources} />
            </li>
          ))}
        </ul>
      ) : null}
      {research.caveats.length ? (
        <ul className="mt-3 list-disc space-y-1 border-t pt-3 pl-4 text-xs leading-relaxed text-muted-foreground">
          {research.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Site({ report }: { report: LandReport }) {
  const { location: l, climate: c, water: w, sensors: s } = report;
  const maxEt0 = Math.max(...c.et0_monthly_mm);
  const period =
    c.source === "open-meteo-archive" && c.period
      ? `Last 12 months, ${formatDay(c.period.start)} – ${formatDay(c.period.end)} (Open-Meteo archive, ERA5)`
      : c.note ?? "Typical values";
  const rows: Array<[string, string]> = [
    ["Water demand (ET₀)", `${thousands(c.et0_annual_mm)} mm a year`],
    ["Summer highs", `${c.summer_tmax_mean_c} °C average, Jun–Sep`],
    ["Hottest", `${c.hottest_c} °C; ${c.days_above_45c} days at 45 °C or more`],
    ["Winter lows", `${c.winter_tmin_mean_c} °C average, Dec–Feb`],
    ["Summer humidity", `${c.summer_humidity_mean_pct}% average`],
    ["Wind", `${c.wind_mean_m_s} m/s mean; ${c.dust_wind_days} days with gusts of 10 m/s or more`],
    ["Rain", `${c.rain_annual_mm} mm a year`],
  ];
  return (
    <section aria-labelledby="site-heading" className={CARD}>
      <h2 id="site-heading" className={H2}>
        <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
        Site
      </h2>
      <p className="mt-2 text-xl font-semibold tabular">
        {coord(l.lat, "N", "S")}, {coord(l.lng, "E", "W")}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {l.place} · {l.municipality}
        {c.elevation_m != null ? ` · ${Math.round(c.elevation_m)} m above sea level` : ""}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Sea</dt>
          <dd className="tabular">
            {l.distance_to_coast_km.toFixed(1)} km ({l.coast_band.replace("-", " ")})
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Groundwater basin</dt>
          <dd className="tabular">
            {l.groundwater_basin === "northern" ? "Northern" : "Southern"}, typically ECw {l.typical_groundwater_ec_dS_m.low.toFixed(1)}–{l.typical_groundwater_ec_dS_m.high.toFixed(1)} dS/m
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Water used for the ranking</dt>
          <dd>
            <span className="font-medium tabular">
              {WATER_SOURCE_LABEL[w.source]}, ECw {w.ec_dS_m} dS/m ({w.ec_origin})
            </span>
            <span className="block text-muted-foreground">
              {w.class}. Expected soil salinity ECe ≈ {w.ece_expected_dS_m} dS/m. {w.note}
            </span>
          </dd>
        </div>
      </dl>
      {l.notes.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-pretty text-muted-foreground">
          {l.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
        <ThermometerSun className="size-4 text-muted-foreground" aria-hidden="true" />
        Climate
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{period}</p>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Water demand (ET₀) by month, mm</p>
      <div
        role="img"
        aria-label={`Monthly ET₀, January to December: ${c.et0_monthly_mm.map((v) => `${v} mm`).join(", ")}`}
        className="mt-1.5 flex h-20 items-end gap-1"
      >
        {c.et0_monthly_mm.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div className="w-full rounded-t-sm bg-primary/70" style={{ height: `${Math.max(4, (v / maxEt0) * 100)}%` }} />
            <span className="text-xs leading-none text-muted-foreground" aria-hidden="true">
              {MONTH_INITIAL[i]}
            </span>
          </div>
        ))}
      </div>

      {s ? (
        <>
          <h3 className="mt-5 text-sm font-semibold">On-site sensors</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {s.farm_name} ({s.crop}), last {s.days} days · measured: {s.measured.join(", ")}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Soil moisture</dt>
              <dd className="tabular">{s.soil_moisture_pct != null ? `${s.soil_moisture_pct}%` : "No sensor"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Air max</dt>
              <dd className="tabular">{s.air_tmax_mean_c != null ? `${s.air_tmax_mean_c} °C` : "No sensor"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Humidity</dt>
              <dd className="tabular">{s.humidity_mean_pct != null ? `${s.humidity_mean_pct}%` : "No sensor"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Soil salinity</dt>
              <dd className="tabular">{s.ece_dS_m != null ? `ECe ${s.ece_dS_m} dS/m` : "No sensor"}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}

function Goals({ report }: { report: LandReport }) {
  return (
    <section aria-labelledby="goals-heading" className={CARD}>
      <h2 id="goals-heading" className={H2}>
        <Target className="size-4 text-muted-foreground" aria-hidden="true" />
        Qatar&apos;s 2030 food goals
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Self-sufficiency now and the National Food Security Strategy target, biggest gap first.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-2 font-medium">
              Product
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Now
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              2030
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Gap
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {report.goals.map((g) => (
            <tr key={g.product}>
              <th scope="row" className="py-2 pr-2 text-left font-medium">
                {g.source_url ? (
                  <a href={g.source_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center hover:underline sm:min-h-0 sm:min-w-0">
                    {g.label}
                  </a>
                ) : (
                  g.label
                )}
              </th>
              <td className="py-2 pr-2 text-right tabular">
                {g.current_pct}% <span className="text-xs text-muted-foreground">({g.current_year})</span>
              </td>
              <td className="py-2 pr-2 text-right tabular">{g.target_pct != null ? `${g.target_pct}%` : "–"}</td>
              <td className="py-2 text-right font-semibold tabular">{g.gap_pct != null ? `${g.gap_pct} pts` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MarketNow({ report }: { report: LandReport }) {
  const m = report.market_now;
  return (
    <section aria-labelledby="market-heading" className={CARD}>
      <h2 id="market-heading" className={H2}>
        Market now
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Qatar&apos;s {m.season}.</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-medium">Short in local markets</dt>
          <dd className="text-muted-foreground">{m.scarce.length ? m.scarce.join(", ") : "Nothing notably short this month"}</dd>
        </div>
        <div>
          <dt className="font-medium">Glut risk</dt>
          <dd className="text-muted-foreground">{m.glut.length ? m.glut.join(", ") : "None this month"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{m.note}</p>
    </section>
  );
}

export function LandReportView({ report }: { report: LandReport }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-6">
      <BestUse report={report} />
      <Options report={report} />
      <div className="grid grid-cols-1 gap-4 lg:gap-6 2xl:grid-cols-2">
        <Research research={report.research} />
        <div className="grid grid-cols-1 content-start gap-4 lg:gap-6">
          <Goals report={report} />
          <MarketNow report={report} />
        </div>
      </div>
      <Site report={report} />
      <details className="rounded-2xl border bg-card px-5 shadow-xs sm:px-6">
        <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold">How the ranking works</summary>
        <ul className="list-disc space-y-1 pb-5 pl-5 text-sm leading-relaxed text-pretty text-muted-foreground">
          {report.method.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
