"use client";

/**
 * Home (`/dashboard`): the portfolio. Which farms need me, and why — every farm ranked by risk in
 * one table with the week's most urgent actions beside it, then the irrigation schedule and a map
 * of all the farms. Each farm opens its own workspace. Phones: headline → do first → farms → water → map.
 */
import { ArrowRight, Droplets, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HealthDot, RISK_TONE, riskLabel } from "@/components/dashboard/risk-badge";
import { GetStarted } from "@/components/devices/get-started";
import { IrrigationCard } from "@/components/home/irrigation-card";
import { RiskSparkline } from "@/components/insights/risk-sparkline";
import { OverviewMap } from "@/components/overview/overview-map";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { useDoneActions } from "@/hooks/use-done-actions";
import { useLiveDashboard } from "@/hooks/use-live-dashboard";
import { lastDataIndex } from "@/lib/ai/analysis";
import { PRIORITY_TONE, rankFarms, weeklyActions, type HealthTone } from "@/lib/dashboard";
import { actionAnchor, actionKey } from "@/lib/done-actions";
import { fmtNum, formatLongDay } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics";
import { farmRow, portfolioHeadline, portfolioSummary, type FarmRow } from "@/lib/portfolio";
import { farmTabHref } from "@/lib/routes";
import type { DashboardData } from "@/lib/types";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border bg-card shadow-xs";
const LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-8 sm:pointer-coarse:min-h-11";
/** A row-wide link: the farm name stretches its hit area over the whole row. */
const ROW_LINK =
  "font-semibold after:absolute after:inset-0 after:rounded-[inherit] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset";

function toneOf(row: FarmRow): HealthTone {
  return row.riskLevel ? RISK_TONE[row.riskLevel] : "none";
}

function riskText(row: FarmRow): string {
  return row.riskLevel ? `${riskLabel(row.riskLevel)}${row.riskScore != null ? `, score ${row.riskScore}` : ""}` : "No assessment yet";
}

/** A summary count: plain text with its dot, so it doesn't pass for a button. */
function Chip({ tone, icon, count, label }: { tone?: HealthTone; icon?: React.ReactNode; count: number; label: string }) {
  return (
    <li className="inline-flex items-center gap-2 text-sm">
      {tone ? <HealthDot tone={tone} className="ring-0" /> : <span className="text-chart-3 [&_svg]:size-4" aria-hidden="true">{icon}</span>}
      <span>
        <span className="font-semibold tabular">{count}</span> <span className="text-muted-foreground">{label}</span>
      </span>
    </li>
  );
}

function Flash({ at }: { at?: number }) {
  return <span key={at} className={cn("pointer-events-none absolute inset-0", at ? "yai-flash" : undefined)} aria-hidden="true" />;
}

/** Desktop and tablet: every farm as a table row, riskiest first, on its latest readings. */
function FarmTable({ rows, flashes }: { rows: FarmRow[]; flashes: Record<string, number> }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">Farms ranked by risk, with their latest readings</caption>
      <thead>
        <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
          <th scope="col" className="py-2 pr-3 pl-5 font-medium">
            Farm
          </th>
          <th scope="col" className="w-[5.5rem] px-3 py-2 text-right font-medium">
            Salinity <span className="font-normal">dS/m</span>
          </th>
          <th scope="col" className="hidden w-36 py-2 pr-5 pl-3 font-medium md:table-cell">
            Risk trend
          </th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((row) => (
          <tr key={row.id} className="relative transition-colors hover:bg-muted/40">
            <td className="h-16 max-w-0 py-2 pr-3 pl-5">
              <Flash at={flashes[row.id]} />
              <div className="flex items-center gap-3">
                <HealthDot tone={toneOf(row)} label={riskText(row)} className="ring-0" />
                <div className="min-w-0">
                  <Link href={farmTabHref(row.id)} className={cn(ROW_LINK, "block truncate")}>
                    {row.name}
                  </Link>
                  {/* Only farms that need something say why; in-range farms stay quiet. */}
                  {row.reason.tone === "ok" ? null : (
                    <p className={cn("truncate text-xs", row.reason.tone === "bad" ? "font-medium text-risk-high-ink" : row.reason.tone === "warn" ? "font-medium text-risk-medium-ink" : "text-muted-foreground")}>
                      {row.reason.label}
                    </p>
                  )}
                </div>
              </div>
            </td>
            <td className={cn("px-3 py-2 text-right tabular", row.overLimit && "font-semibold")}>{fmtNum(row.ece, 1)}</td>
            <td className="hidden py-2 pr-5 pl-3 md:table-cell">
              <RiskSparkline points={row.history} level={row.riskLevel} width={96} height={24} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Phones: one compact card row per farm. */
function FarmList({ rows, flashes }: { rows: FarmRow[]; flashes: Record<string, number> }) {
  return (
    <ul className="divide-y border-t" aria-label="Farms ranked by risk">
      {rows.map((row) => (
        <li key={row.id} className="relative px-4 py-3">
          <Flash at={flashes[row.id]} />
          <div className="flex items-center gap-3">
            <HealthDot tone={toneOf(row)} label={riskText(row)} className="ring-0" />
            <Link href={farmTabHref(row.id)} className={cn(ROW_LINK, "min-w-0 flex-1 truncate text-base")}>
              {row.name}
            </Link>
            <span className="text-sm font-semibold tabular text-muted-foreground">{row.riskScore ?? ""}</span>
          </div>
          <p className="mt-0.5 pl-5.5 text-sm text-muted-foreground">
            <span className="text-foreground">{row.reason.label}</span> · {row.crop} · {fmtNum(row.ece, 1)} dS/m
          </p>
        </li>
      ))}
    </ul>
  );
}

function PickedFarm({ row, onClose }: { row: FarmRow; onClose: () => void }) {
  return (
    <div className="rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex items-start gap-2.5">
        <HealthDot tone={toneOf(row)} label={riskText(row)} className="mt-1.5 ring-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.reason.label} · {row.crop}
            {row.riskScore != null ? ` · risk ${row.riskScore}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Show all farms"
          className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none pointer-coarse:size-11"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <Button asChild className="mt-2.5 h-9 w-full pointer-coarse:h-11">
        <Link href={farmTabHref(row.id)}>
          Open farm <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

export function Home({
  data: serverData,
  userName,
  greeting,
  initialLayer,
}: {
  data: DashboardData;
  userName: string;
  greeting: string;
  initialLayer?: MetricKey;
}) {
  const shell = useShell();
  const { data, pulse, flashes } = useLiveDashboard(serverData);
  const { dates } = data;
  const last = dates.length - 1;
  const ranked = useMemo(() => rankFarms(data.farms), [data.farms]);
  const rows = useMemo(() => ranked.map((b) => farmRow(b, dates)), [ranked, dates]);
  const summary = portfolioSummary(rows);
  const urgent = useMemo(() => weeklyActions(ranked).filter((a) => a.rec.priority === "high"), [ranked]);
  // Actions ticked off on the Plan or a farm's Advice tab drop out here too.
  const { done } = useDoneActions();
  const doFirst = urgent.filter((a) => !done.has(actionKey(a.farm.id, a.rec.title)));

  // The latest day any farm has readings for; today when none has any yet (a new account).
  const latestWithData = useMemo(() => {
    const i = Math.max(-1, ...serverData.farms.map((b) => lastDataIndex(b)));
    return i >= 0 ? i : serverData.dates.length - 1;
  }, [serverData]);
  const [metricKey, setMetricKey] = useState<MetricKey>(initialLayer ?? "ece");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [dateIndex, setDateIndex] = useState(latestWithData);
  const [compare, setCompare] = useState(false);
  const [thenIndex, setThenIndex] = useState(Math.max(0, latestWithData - 30));
  const [historyOpen, setHistoryOpen] = useState(false);
  // Live mode always shows today.
  const shownIndex = shell.live && !compare ? last : dateIndex;
  const picked = ranked.find((b) => b.farm.id === pickedId) ?? null;
  const pickedRow = rows.find((r) => r.id === pickedId) ?? null;
  const firstName = userName.split(/\s+/)[0];

  if (ranked.length === 0) {
    if (data.source === "account") {
      return (
        <div className="flex min-h-[60dvh] items-center justify-center px-4">
          <GetStarted error={data.account?.error} />
        </div>
      );
    }
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">No farms yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Add farms to Supabase (or run <code>npm run seed</code>) and they will appear here.
        </p>
      </div>
    );
  }

  const changeDate = (index: number) => {
    if (shell.live && index !== last) shell.setLive(false);
    setDateIndex(index);
  };
  const changeCompare = (on: boolean) => {
    setCompare(on);
    if (on && thenIndex >= dateIndex) setThenIndex(Math.max(0, dateIndex - 30));
  };

  return (
    <div className="yai-enter px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8">
      <header>
        <p className="text-sm text-muted-foreground">{formatLongDay(dates[latestWithData] ?? dates[last])}</p>
        <h1 className="mt-1 font-display text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-[2.25rem]">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-pretty">{portfolioHeadline(rows)}</p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Summary">
          {summary.attention ? <Chip tone="bad" count={summary.attention} label="need attention" /> : null}
          {summary.watch ? <Chip tone="warn" count={summary.watch} label="to watch" /> : null}
          {/* The green dots already say which farms are fine; the count only matters when all are. */}
          {summary.healthy && !summary.attention && !summary.watch ? <Chip tone="ok" count={summary.healthy} label="in range" /> : null}
          {summary.irrigateToday ? <Chip icon={<Droplets />} count={summary.irrigateToday} label="to water today" /> : null}
        </ul>
      </header>

      {/* Desktop: farms then water on the left; do first then the map (filling the column) on the right.
          Two independent columns, so a short farm list leaves no empty space inside its card. Below xl
          the column wrappers dissolve (display: contents) into one grid: phones read do first → farms →
          water → map. */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
          <section aria-labelledby="farms-heading" className={cn(CARD, "overflow-hidden md:max-xl:col-span-2")}>
            <h2 id="farms-heading" className="px-4 pt-4 pb-3 text-base font-semibold sm:px-5">
              Farms
            </h2>
            <div className="hidden md:block">
              <FarmTable rows={rows} flashes={flashes} />
            </div>
            <div className="md:hidden">
              <FarmList rows={rows} flashes={flashes} />
            </div>
          </section>
          <IrrigationCard rows={rows} />
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-6">
          <section aria-labelledby="dofirst-heading" className={cn(CARD, "p-4 sm:p-5 max-md:order-first")}>
            <h2 id="dofirst-heading" className="text-base font-semibold">
              Do first this week
            </h2>
            {doFirst.length > 0 ? (
              <ol className="mt-2 divide-y">
                {doFirst.slice(0, 3).map(({ rec, farm }) => (
                  <li key={`${farm.id}-${rec.title}`} className="relative flex gap-3 py-3">
                    <HealthDot tone={PRIORITY_TONE[rec.priority]} className="mt-1.5 ring-0" />
                    <div className="min-w-0">
                      <Link href={`${farmTabHref(farm.id, "advice")}#${actionAnchor(rec.title)}`} className={cn(ROW_LINK, "text-sm leading-snug text-pretty")}>
                        {rec.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">{farm.name}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : urgent.length > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">All {urgent.length} urgent actions are done. The plan has the rest of the week.</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Nothing urgent. Every farm is in range; keep the current schedules.</p>
            )}
            <Link href="/dashboard/insights" className={cn(LINK, "mt-1")}>
              {doFirst.length > 3 ? `See all ${doFirst.length} on the plan` : "Open the plan"} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </section>
          <OverviewMap
            farms={ranked}
            bundle={picked}
            metricKey={metricKey}
            onMetricChange={setMetricKey}
            onSelect={setPickedId}
            dates={dates}
            dateIndex={shownIndex}
            onDateIndex={changeDate}
            compare={compare}
            onCompareChange={changeCompare}
            thenIndex={thenIndex}
            onThenIndex={setThenIndex}
            historyOpen={historyOpen}
            onHistoryOpenChange={setHistoryOpen}
            pulse={pulse}
            overlay={pickedRow ? <PickedFarm row={pickedRow} onClose={() => setPickedId(null)} /> : null}
            heightClassName="h-[360px] sm:h-[440px] xl:h-auto xl:min-h-[18rem] xl:flex-1"
            className="md:max-xl:col-span-2 xl:flex xl:flex-1 xl:flex-col"
          />
        </div>
      </div>
    </div>
  );
}
