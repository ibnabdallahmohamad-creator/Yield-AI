import type { Metadata } from "next";
import { ArrowRight, Sparkles, Sprout } from "lucide-react";
import Link from "next/link";
import { HealthDot, RiskBadge } from "@/components/dashboard/risk-badge";
import { GetStarted } from "@/components/devices/get-started";
import { CropSuggestion, MarketChip, WeeklyActions } from "@/components/insights/farm-advice";
import { FarmFilter, HowItWorks, ReportFarm } from "@/components/insights/insights-controls";
import { RiskSparkline } from "@/components/insights/risk-sparkline";
import { CROPS } from "@/lib/agronomy-tables";
import { requireUser } from "@/lib/auth/session";
import { cropChoice, plainHeadline, rankFarms, riskReason, weeklyActions, type CropChoice } from "@/lib/dashboard";
import { getDashboardFor } from "@/lib/data/repository";
import { fmtNum, formatShortDay, formatTime, qatarDay } from "@/lib/format";
import { farmRow, irrigationSchedule, type FarmRow } from "@/lib/portfolio";
import { assistantHref, farmTabHref, insightsHref, type PlanView } from "@/lib/routes";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Plan" };

const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";
const LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-8 sm:pointer-coarse:min-h-11";

function updatedLabel(farms: FarmBundle[]): string | null {
  const latest = farms.map((b) => b.insight?.created_at).filter((v): v is string => Boolean(v)).sort().at(-1);
  return latest ? `Updated ${formatShortDay(qatarDay(latest))}, ${formatTime(latest)}` : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The Plan (`/dashboard/insights`): what to do across the farms this week, or which crop to plant
 * next season. `?farm=` narrows it to one farm; a farm's full written assessment lives on its
 * Advice tab.
 */
export default async function PlanPage({ searchParams }: PageProps<"/dashboard/insights">) {
  const user = await requireUser("/dashboard/insights");
  const [{ farm, view }, data] = await Promise.all([searchParams, getDashboardFor(user)]);
  const ranked = rankFarms(data.farms);
  const selected = typeof farm === "string" ? ranked.find((b) => b.farm.id === farm) : undefined;
  const unknownFarm = typeof farm === "string" && !selected ? farm : null;
  const planView: PlanView = view === "season" ? "season" : "week";
  const scope = selected ? [selected] : ranked;

  // A new account: no farms, or no readings yet, so there is nothing to advise on.
  if (data.source === "account" && !ranked.some((b) => b.insight)) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center px-4">
        <GetStarted hasFarms={ranked.length > 0} error={data.account?.error} />
      </div>
    );
  }

  const actions = weeklyActions(scope);
  const farmsWithActions = new Set(actions.map((a) => a.farm.id)).size;
  const rows = scope.map((b) => farmRow(b, data.dates));
  const updated = updatedLabel(scope);
  const meta =
    planView === "season"
      ? `Which crop to plant next, at ${selected ? `${selected.farm.name}'s` : "each farm's"} current salinity`
      : selected
        ? `${plural(actions.length, "action")} for ${selected.farm.name} this week`
        : `What to do this week across your farms`;

  return (
    <div className="yai-enter px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6">
      {selected ? <ReportFarm farmId={selected.farm.id} /> : null}
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {meta}
            {updated ? <span className="whitespace-nowrap"> · {updated}</span> : null}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <ViewSwitch farmId={selected?.farm.id ?? null} view={planView} />
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
            <FarmFilter farms={ranked.map((b) => ({ id: b.farm.id, name: b.farm.name }))} value={selected?.farm.id ?? null} view={planView} />
            <HowItWorks />
          </div>
        </div>
      </header>
      {unknownFarm ? (
        <p role="status" className="mt-4 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          There&apos;s no farm called &ldquo;{unknownFarm}&rdquo;, so here is the plan for every farm.
        </p>
      ) : null}

      {planView === "week" ? (
        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section aria-labelledby="week-heading" className={CARD}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="week-heading" className="text-xl font-semibold tracking-tight">
                This week
              </h2>
              <p className="text-sm text-muted-foreground">
                {plural(actions.length, "action")}
                {selected ? "" : ` across ${plural(farmsWithActions, "farm")}`}
              </p>
            </div>
            {actions.length > 0 ? (
              <WeeklyActions actions={actions} limit={selected ? actions.length : 6} showFarm={!selected} className="mt-6" />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Nothing to do this week. {selected ? "This farm is" : "Every farm is"} in range; keep the current schedules.</p>
            )}
          </section>

          <aside aria-label="Alongside the plan" className="grid gap-4 sm:grid-cols-2 lg:gap-6 xl:sticky xl:top-20 xl:grid-cols-1">
            {selected ? <FarmCard bundle={selected} /> : null}
            <Irrigation rows={rows} />
          </aside>
        </div>
      ) : selected ? (
        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section aria-labelledby="season-heading" className={CARD}>
            <h2 id="season-heading" className="text-xl font-semibold tracking-tight">
              Next season
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Growing {CROPS[selected.farm.main_crop].name.toLowerCase()} now. A seasonal decision, not a weekly one.
            </p>
            {cropChoice(selected) || selected.insight?.crop_suggestion ? (
              <CropSuggestion choice={cropChoice(selected)} note={selected.insight?.crop_suggestion ?? null} className="mt-4" />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No readings yet, so there is no salinity to plan the next crop around.</p>
            )}
          </section>
          <aside aria-label="Alongside the plan">
            <FarmCard bundle={selected} />
          </aside>
        </div>
      ) : (
        <NextSeason ranked={ranked} rows={rows} />
      )}
    </div>
  );
}

/** "This week | Next season", as links so each view has its own address. */
function ViewSwitch({ farmId, view }: { farmId: string | null; view: PlanView }) {
  const options: Array<{ value: PlanView; label: string }> = [
    { value: "week", label: "This week" },
    { value: "season", label: "Next season" },
  ];
  return (
    <nav aria-label="Plan view" className="flex w-full rounded-lg bg-sand-200/70 p-0.5 ring-1 ring-black/5 ring-inset sm:w-auto">
      {options.map((o) => (
        <Link
          key={o.value}
          href={insightsHref(farmId, o.value)}
          aria-current={view === o.value ? "page" : undefined}
          className={cn(
            "inline-flex h-11 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:h-8 sm:flex-none sm:pointer-coarse:h-11",
            view === o.value && "bg-card text-foreground shadow-sm hover:bg-card",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** One farm's risk at a glance, with the way to its full assessment. */
function FarmCard({ bundle }: { bundle: FarmBundle }) {
  const { farm, insight } = bundle;
  const reason = riskReason(bundle);
  return (
    <section aria-labelledby="farm-card-heading" className={CARD}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="farm-card-heading" className="text-base font-semibold">
          {farm.name}
        </h2>
        {insight ? <RiskBadge level={insight.risk_level} score={Math.round(insight.risk_score)} compact /> : null}
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <HealthDot tone={reason.tone} className="ring-0" />
        {reason.label} · {CROPS[farm.main_crop].name}
      </p>
      <RiskSparkline points={bundle.riskHistory} level={insight?.risk_level ?? null} width={280} height={56} className="mt-3 h-auto w-full" />
      <p className="mt-3 text-sm leading-relaxed text-pretty text-muted-foreground">{plainHeadline(bundle)}</p>
      <div className="mt-2 flex flex-col items-start">
        <Link href={farmTabHref(farm.id, "advice")} className={LINK}>
          Full assessment <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <Link href={assistantHref(farm.id, `Walk me through this week's plan for ${farm.name}.`, insight?.id)} className={LINK}>
          <Sparkles className="size-4" aria-hidden="true" />
          Ask AI to plan the week
        </Link>
      </div>
    </section>
  );
}

/** When each farm next needs water: the part of the plan that runs on a clock. */
function Irrigation({ rows }: { rows: FarmRow[] }) {
  const schedule = irrigationSchedule(rows);
  return (
    <section aria-labelledby="water-heading" className={CARD}>
      <h2 id="water-heading" className="text-base font-semibold">
        Irrigation
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Next watering and how much, including water to flush salt.</p>
      {schedule.length > 0 ? (
        <ol className="mt-2 divide-y">
          {schedule.map((g) => (
            <li key={g.when} className="flex gap-3 py-2.5">
              <span className={cn("w-[4.5rem] shrink-0 text-sm font-semibold", g.status === "now" ? "text-risk-high-ink" : g.status === "soon" ? "text-risk-medium-ink" : undefined)}>
                {g.when}
              </span>
              <ul className="min-w-0 flex-1 space-y-1">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{r.name}</span>
                    <span className="shrink-0 tabular text-muted-foreground">{r.irrigation.grossMm} mm</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No readings to plan irrigation yet.</p>
      )}
    </section>
  );
}

interface SeasonRow {
  bundle: FarmBundle;
  row: FarmRow;
  choice: CropChoice | null;
  keep: boolean;
  /** % of a full crop the current crop gives at today's salinity. */
  yieldNow: number | null;
  /** Why switch, in a few words (market-led switches can give up a little yield). */
  why: string | null;
}

function switchReason(choice: CropChoice, yieldNow: number | null): string {
  if (choice.alternative) return `Oversupplied; ${choice.alternative.name.toLowerCase()} sells better (${fmtNum(choice.alternative.relativeYield, 0)}%)`;
  if (yieldNow == null || choice.best.relativeYield > yieldNow + 2) return "Grows better at this salt level";
  if (choice.best.market === "undersupplied") return "About the same yield, and in demand";
  return "Suggested in the latest assessment";
}

function PlantNext({ s }: { s: SeasonRow }) {
  if (!s.choice) return <span className="text-muted-foreground">{s.bundle.insight?.crop_suggestion?.crop ?? "No readings yet"}</span>;
  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-1.5 font-semibold">
        <Sprout className="size-4 shrink-0 text-primary" aria-hidden="true" />
        {s.keep ? `Keep ${s.choice.best.name.toLowerCase()}` : s.choice.best.name}
      </span>
      {s.why ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{s.why}</span> : null}
    </span>
  );
}

/** Every farm's next crop in one table: what grows now, how well, and what would grow better. */
function NextSeason({ ranked, rows }: { ranked: FarmBundle[]; rows: FarmRow[] }) {
  const seasons: SeasonRow[] = ranked.map((bundle, i) => {
    const row = rows[i];
    const choice = cropChoice(bundle);
    const keep = choice?.best.crop === bundle.farm.main_crop;
    const yieldNow = row.yieldLoss == null ? null : Math.max(0, 100 - row.yieldLoss);
    return { bundle, row, choice, keep, yieldNow, why: choice && !keep ? switchReason(choice, yieldNow) : null };
  });
  const switching = seasons.filter((s) => s.choice && !s.keep).length;

  return (
    <section aria-labelledby="season-heading" className={cn(CARD, "mt-5 p-0 sm:p-0")}>
      <div className="px-5 pt-5 pb-4 sm:px-6">
        <h2 id="season-heading" className="text-xl font-semibold tracking-tight">
          Next season
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {switching > 0 ? `${plural(switching, "farm")} would do better with another crop. ` : "Every farm is on the best crop for its salt level. "}
          Yields are % of a full crop at today&apos;s salinity.
        </p>
      </div>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 pl-6 font-medium">
              Farm
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Salinity <span className="font-normal">dS/m</span>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Growing now
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Plant next
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Yield <span className="font-normal">now → next</span>
            </th>
            <th scope="col" className="py-2 pr-6 pl-3 font-medium">
              Market
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {seasons.map((s) => (
            <tr key={s.bundle.farm.id} className="align-top">
              <td className="py-3 pr-3 pl-6">
                <Link href={farmTabHref(s.bundle.farm.id, "advice")} className="font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                  {s.bundle.farm.name}
                </Link>
              </td>
              <td className={cn("px-3 py-3 text-right tabular", s.row.overLimit && "font-semibold")}>{fmtNum(s.row.ece, 1)}</td>
              <td className="px-3 py-3">{CROPS[s.bundle.farm.main_crop].name}</td>
              <td className={cn("px-3 py-3", s.keep && "text-muted-foreground")}>
                <PlantNext s={s} />
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                {s.choice ? (
                  <>
                    <span className="text-muted-foreground">{fmtNum(s.yieldNow, 0)}%</span>
                    {s.keep ? null : (
                      <>
                        {" → "}
                        <span className="font-semibold">{fmtNum(s.choice.best.relativeYield, 0)}%</span>
                      </>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-3 pr-6 pl-3">{s.choice ? <MarketChip status={s.choice.best.market} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y border-t md:hidden" aria-label="Next season by farm">
        {seasons.map((s) => (
          <li key={s.bundle.farm.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={farmTabHref(s.bundle.farm.id, "advice")} className="inline-flex min-h-11 min-w-0 items-center truncate font-semibold hover:underline">
                {s.bundle.farm.name}
              </Link>
              <span className="shrink-0 text-sm text-muted-foreground tabular">{fmtNum(s.row.ece, 1)} dS/m</span>
            </div>
            <div className={cn("text-sm", s.keep && "text-muted-foreground")}>
              <PlantNext s={s} />
            </div>
            {s.choice && !s.keep ? (
              <p className="mt-0.5 text-sm text-muted-foreground tabular">
                {CROPS[s.bundle.farm.main_crop].name} {fmtNum(s.yieldNow, 0)}% → {s.choice.best.name.toLowerCase()} {fmtNum(s.choice.best.relativeYield, 0)}%
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
