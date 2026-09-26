"use client";

/**
 * Advice building blocks (ui_improvement §6): an action with a done tick and ▸ Why (the rest of the
 * detail, the method, the evidence links and the hand-off to the assistant), next season's crop,
 * and one farm's full advice. Used on the Plan and on a farm's Advice tab.
 *
 * Props are small serialisable objects (not farm bundles), so server pages can render these.
 */
import { Check, ChevronDown, ChevronRight, LineChart, MapPin, Minus, Sparkles, Sprout, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { Button } from "@/components/ui/button";
import type { CropOption } from "@/lib/ai/analysis";
import type { AiInsight, CropSuggestion as CropSuggestionNote, Priority, Recommendation } from "@/lib/ai/contract";
import type { MarketStatus } from "@/lib/agronomy-tables";
import { chartForAction, METHOD_LINE } from "@/lib/charts";
import { MARKET_LABEL, PRIORITY_TONE, PRIORITY_WORD, sortedActions, type ActionFarm, type CropChoice, type FarmAction } from "@/lib/dashboard";
import { useDoneActions } from "@/hooks/use-done-actions";
import { actionAnchor, actionKey } from "@/lib/done-actions";
import { fmtNum, plural, splitFirstSentence } from "@/lib/format";
import { assistantHref, farmChartHref, farmTabHref } from "@/lib/routes";
import { cn } from "@/lib/utils";

const MARKET_ICON: Record<MarketStatus, typeof TrendingUp> = { undersupplied: TrendingUp, oversupplied: TrendingDown, "no-signal": Minus };

/** Market signal: neutral grey, the arrow carries the direction (colour is reserved for risk). */
export function MarketChip({ status, className }: { status: MarketStatus; className?: string }) {
  const Icon = MARKET_ICON[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-xs font-semibold whitespace-nowrap text-muted-foreground", className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {MARKET_LABEL[status]}
    </span>
  );
}

export const ADVICE_LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-8 sm:pointer-coarse:min-h-11";
/** Beside every action: quiet until hovered, so a list of actions reads as its titles. */
const ACTION_LINK =
  "inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none aria-expanded:text-primary sm:min-h-7 sm:pointer-coarse:min-h-11";

/**
 * The round tick in front of an action. Its name is the action's title (`labelledBy`); the 44px hit
 * area overhangs by 10px on each side, so the list keeps its rhythm.
 */
export function DoneCheck({ done, onChange, labelledBy, className }: { done: boolean; onChange: (done: boolean) => void; labelledBy: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-labelledby={labelledBy}
      title={done ? "Done. Tap to undo" : "Mark done"}
      onClick={() => onChange(!done)}
      className={cn("group/check -m-2.5 grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-none", className)}
    >
      <span
        className={cn(
          "grid size-[22px] place-items-center rounded-full border-2 transition-colors group-focus-visible/check:ring-2 group-focus-visible/check:ring-ring/60",
          done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/45 text-primary group-hover/check:border-primary",
        )}
      >
        <Check className={cn("size-3.5 stroke-[3]", !done && "opacity-0 group-hover/check:opacity-60")} aria-hidden="true" />
      </span>
    </button>
  );
}

// The page's #fragment, so the action a link points at opens itself (Home's "Do first" → Advice).
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}
function useHash(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
}

/**
 * One action in a priority group (the group says the priority): a tick, the title with Why beside it,
 * and the first sentence. Why opens the rest: the method, the chart, the map and the assistant.
 * With `anchor` set (one farm's list) the item can be linked to, and opens when it is.
 */
export function ActionItem({
  rec,
  farm,
  done = false,
  onDoneChange,
  anchor = false,
  showFarmName = false,
  showMapLink = false,
}: {
  rec: Recommendation;
  farm: ActionFarm;
  done?: boolean;
  onDoneChange?: (done: boolean) => void;
  anchor?: boolean;
  /** Name the farm under the title (lists that mix farms without grouping them). */
  showFarmName?: boolean;
  /** Offer "View on map" under Why (for pages without the farm's map). */
  showMapLink?: boolean;
}) {
  const hash = useHash();
  const id = anchor ? actionAnchor(rec.title) : undefined;
  const targeted = id != null && hash === `#${id}`;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? targeted;
  const whyId = useId();
  const titleId = useId();
  const [first, rest] = splitFirstSentence(rec.detail);
  const chart = chartForAction(rec);

  return (
    <li id={id} className={cn("flex scroll-mt-32 items-start gap-3 rounded-lg", targeted && "-mx-2 bg-primary/5 px-2 py-2 ring-1 ring-primary/25")}>
      {onDoneChange ? <DoneCheck done={done} onChange={onDoneChange} labelledBy={titleId} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p id={titleId} className={cn("min-w-0 flex-1 text-base leading-snug font-semibold text-pretty", done && "text-muted-foreground line-through decoration-muted-foreground/60")}>
            {rec.title}
          </p>
          <button
            type="button"
            onClick={() => setToggled(!open)}
            aria-expanded={open}
            aria-controls={open ? whyId : undefined}
            className={cn(ACTION_LINK, "-my-2.5 shrink-0 sm:-my-0.5 sm:pointer-coarse:-my-2.5")}
          >
            Why
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
        {showFarmName ? <p className="text-xs text-muted-foreground">{farm.name}</p> : null}
        {first && !done ? <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{first}</p> : null}
        {open ? (
          <div id={whyId} className="mt-2 space-y-2 border-l-2 border-primary/30 pl-3">
            {rest ? <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{rest}</p> : null}
            <p className="text-xs leading-relaxed text-muted-foreground">{METHOD_LINE[chart]}</p>
            <div className="flex flex-wrap items-center gap-x-5">
              <Link href={farmChartHref(farm.id, chart)} className={ADVICE_LINK}>
                <LineChart className="size-4" aria-hidden="true" />
                See the chart
              </Link>
              {showMapLink ? (
                <Link href={farmTabHref(farm.id)} className={ADVICE_LINK}>
                  <MapPin className="size-4" aria-hidden="true" />
                  View on map
                </Link>
              ) : null}
              <Link href={assistantHref(farm.id, `Explain this recommendation and how to do it: ${rec.title}`, farm.insightId ?? undefined)} className={ADVICE_LINK}>
                <Sparkles className="size-4" aria-hidden="true" />
                Ask AI about this
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ShowAll({ total, limit, all, onToggle }: { total: number; limit: number; all: boolean; onToggle: () => void }) {
  if (total <= limit) return null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={all} className={cn(ADVICE_LINK, "mt-4 w-full justify-center border-t pt-4 sm:min-h-11")}>
      <ChevronRight className={cn("size-4 transition-transform", all ? "-rotate-90" : "rotate-90")} aria-hidden="true" />
      {all ? "Show fewer" : `Show all ${total} actions`}
    </button>
  );
}

interface FarmGroup {
  farm: ActionFarm;
  recs: Recommendation[];
}

/** Group an already-sorted list by priority, then by farm (consecutive runs), so names aren't repeated. */
function groupActions(actions: FarmAction[]): Array<{ priority: Priority; farms: FarmGroup[] }> {
  const out: Array<{ priority: Priority; farms: FarmGroup[] }> = [];
  for (const { rec, farm } of actions) {
    let group = out.at(-1);
    if (!group || group.priority !== rec.priority) {
      group = { priority: rec.priority, farms: [] };
      out.push(group);
    }
    let fg = group.farms.at(-1);
    if (!fg || fg.farm.id !== farm.id) {
      fg = { farm, recs: [] };
      group.farms.push(fg);
    }
    fg.recs.push(rec);
  }
  return out;
}

/**
 * Split actions into what is left and what was ticked earlier. Ticks made while the list is on screen
 * stay in place (struck through, easy to undo) until the next visit, when they fold into "Done".
 */
export function useActionTicks(actions: FarmAction[]) {
  const { done, setDone } = useDoneActions();
  const [inPlace, setInPlace] = useState<ReadonlySet<string>>(() => new Set());
  const keyOf = (a: FarmAction) => actionKey(a.farm.id, a.rec.title);
  const left = actions.filter((a) => !done.has(keyOf(a)) || inPlace.has(keyOf(a)));
  const folded = actions.filter((a) => done.has(keyOf(a)) && !inPlace.has(keyOf(a)));
  const remaining = actions.filter((a) => !done.has(keyOf(a))).length;
  const isDone = (a: FarmAction) => done.has(keyOf(a));
  const tick = (a: FarmAction, value: boolean) => {
    const key = keyOf(a);
    setInPlace((s) => new Set(s).add(key));
    setDone(key, value);
  };
  return { left, folded, remaining, isDone, tick };
}

/** The Plan's subtitle: how many actions are left this week (ticked ones don't count). */
export function ActionsLeft({ actions, farmName }: { actions: FarmAction[]; farmName?: string }) {
  const { done } = useDoneActions();
  const left = actions.filter((a) => !done.has(actionKey(a.farm.id, a.rec.title)));
  const ticked = actions.length - left.length;
  if (ticked > 0 && left.length === 0) return <>All {plural(ticked, "action")} done this week</>;
  const farms = new Set(left.map((a) => a.farm.id)).size;
  return (
    <>
      {farmName ? `${plural(left.length, "action")} for ${farmName} this week` : `${plural(left.length, "action")} across ${plural(farms, "farm")} this week`}
      {ticked > 0 ? ` · ${ticked} done` : null}
    </>
  );
}

/**
 * The Plan's "This week": every farm's actions under Do first / This week / When you can, each run of
 * one farm's actions under the farm's name (which opens its Advice tab). With `showFarm` off (a plan
 * for one farm) the names are left out and each action can be linked to. Shows `limit` actions, then
 * the rest on demand; ticked actions fold into "Done" at the end.
 */
export function WeeklyActions({
  actions,
  limit = 6,
  showFarm = true,
  className,
}: {
  actions: FarmAction[];
  limit?: number;
  showFarm?: boolean;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const { left, folded, isDone, tick } = useActionTicks(actions);
  const totals = new Map<Priority, number>();
  for (const a of left) if (!isDone(a)) totals.set(a.rec.priority, (totals.get(a.rec.priority) ?? 0) + 1);
  const groups = groupActions(all ? left : left.slice(0, limit));
  const actionOf = new Map(actions.map((a) => [a.rec, a]));

  return (
    <div className={className}>
      {left.length === 0 ? <p className="text-sm text-muted-foreground">Everything on this list is done. New advice appears as the readings change.</p> : null}
      <div className="space-y-8">
        {groups.map((g) => {
          const total = totals.get(g.priority) ?? 0;
          return (
            <section key={g.priority} aria-label={`${PRIORITY_WORD[g.priority]}: ${total} action${total === 1 ? "" : "s"}`}>
              <h3 className="flex items-center gap-2 border-b pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <HealthDot tone={PRIORITY_TONE[g.priority]} className="ring-0" />
                {PRIORITY_WORD[g.priority]}
                <span className="ml-auto font-medium tracking-normal normal-case tabular">{total === 0 ? "All done" : `${total} action${total === 1 ? "" : "s"}`}</span>
              </h3>
              <div className="divide-y">
                {g.farms.map((fg) => (
                  <div key={fg.farm.id} className="py-4 last:pb-0">
                    {showFarm ? (
                      <p className="mb-2 flex flex-wrap items-center gap-x-2">
                        <Link
                          href={farmTabHref(fg.farm.id, "advice")}
                          className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-0"
                        >
                          {fg.farm.name}
                        </Link>
                        {fg.farm.riskScore != null ? <span className="text-sm text-muted-foreground tabular">· Risk {fg.farm.riskScore}</span> : null}
                      </p>
                    ) : null}
                    <ol className="space-y-5">
                      {fg.recs.map((rec, i) => {
                        const a = actionOf.get(rec) ?? { rec, farm: fg.farm };
                        return <ActionItem key={`${i}-${rec.title}`} rec={rec} farm={fg.farm} done={isDone(a)} onDoneChange={(v) => tick(a, v)} anchor={!showFarm} showMapLink />;
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <ShowAll total={left.length} limit={limit} all={all} onToggle={() => setAll((v) => !v)} />
      {folded.length > 0 ? (
        <div className="mt-4 border-t pt-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className={cn(ACTION_LINK, "w-full sm:min-h-11")}>
            <ChevronRight className={cn("size-4 transition-transform", showDone && "rotate-90")} aria-hidden="true" />
            Done · {folded.length}
          </button>
          {showDone ? (
            <ol className="mt-2 space-y-3">
              {folded.map((a, i) => (
                <ActionItem key={`${i}-${a.farm.id}-${a.rec.title}`} rec={a.rec} farm={a.farm} done onDoneChange={(v) => tick(a, v)} showFarmName={showFarm} />
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CropOptionCard({ label, option }: { label: string; option: CropOption }) {
  return (
    <div className="min-w-0 rounded-xl border bg-background/60 p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-base font-semibold">
        <Sprout className="size-4 shrink-0 text-primary" aria-hidden="true" />
        {option.name}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground tabular">{fmtNum(option.relativeYield, 0)}% of full yield</p>
      <MarketChip status={option.market} className="mt-2" />
    </div>
  );
}

/**
 * Next season's crop. When the crop that grows best is oversupplied, the two options sit side by
 * side ("Grows best" / "Sells best") so the trade-off reads at a glance (X1).
 */
export function CropSuggestion({ choice, note, className }: { choice: CropChoice | null; note: CropSuggestionNote | null; className?: string }) {
  if (!choice && !note) return null;
  if (choice?.alternative) {
    return (
      <div className={className}>
        <div role="group" aria-label="Crop options" className="grid grid-cols-2 gap-2">
          <CropOptionCard label="Grows best" option={choice.best} />
          <CropOptionCard label="Sells better" option={choice.alternative} />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
          {choice.best.name} grows better at this salinity, but its market is oversupplied this season. {choice.alternative.name} gives up{" "}
          {fmtNum(Math.max(0, choice.best.relativeYield - choice.alternative.relativeYield), 0)} points of yield but{" "}
          {choice.alternative.market === "undersupplied" ? "is in demand" : "isn't oversupplied"}.
        </p>
        {note?.reason ? <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{note.reason}</p> : null}
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Sprout className="size-5 text-primary" aria-hidden="true" />
        <p className="text-base font-semibold">{choice ? choice.best.name : note?.crop}</p>
        {choice ? <MarketChip status={choice.best.market} /> : null}
      </div>
      {choice ? <p className="mt-1 text-sm text-muted-foreground tabular">{fmtNum(choice.best.relativeYield, 0)}% of full yield at this salinity</p> : null}
      {note?.reason ? <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{note.reason}</p> : null}
      {note?.market_note ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Market: </span>
          {note.market_note}
        </p>
      ) : null}
    </div>
  );
}

/** Assessment, all actions and the crop suggestion for one farm. */
export function FarmAdvice({
  farm,
  insight,
  choice,
  title = "Advice",
  showCrop = true,
  className,
}: {
  farm: ActionFarm;
  insight: AiInsight | null;
  choice: CropChoice | null;
  title?: string;
  /** Off where the Harvest & next crop section already covers next season. */
  showCrop?: boolean;
  className?: string;
}) {
  const actions = sortedActions(insight);
  if (!insight) {
    return (
      <section className={cn("rounded-2xl border bg-card p-5 shadow-xs", className)}>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No assessment for {farm.name} yet. It appears as soon as the model writes one. You can still ask the assistant.
        </p>
        <Button asChild variant="outline" className="mt-4 h-11 sm:h-9 sm:pointer-coarse:h-11">
          <Link href={assistantHref(farm.id)}>
            <Sparkles aria-hidden="true" />
            Ask AI instead
          </Link>
        </Button>
      </section>
    );
  }
  return (
    <section aria-labelledby={`advice-${farm.id}`} className={cn("rounded-2xl border bg-card p-5 shadow-xs sm:p-6", className)}>
      <h2 id={`advice-${farm.id}`} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-2 text-base leading-relaxed text-pretty">{insight.summary}</p>
      {actions.length > 0 ? <WeeklyActions actions={actions.map((rec) => ({ rec, farm }))} limit={actions.length} showFarm={false} className="mt-6" /> : null}
      {showCrop && (choice || insight.crop_suggestion) ? (
        <div className="mt-6 border-t pt-5">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Next season</h3>
          <CropSuggestion choice={choice} note={insight.crop_suggestion ?? null} />
        </div>
      ) : null}
    </section>
  );
}
