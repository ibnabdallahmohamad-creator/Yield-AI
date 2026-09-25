"use client";

/**
 * Farm details → Probes (ui_improvement §7.2): per-probe daily means with column groups. The
 * default columns answer "which probe is in trouble"; "Nutrients & pH" adds the rest. The main
 * columns carry a small bar against the crop's limit, coloured past a risk threshold, so probes stay
 * comparable when every one is over the limit; only the worst value is also written in red.
 * Phones get one card per probe instead of a table.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CROPS } from "@/lib/agronomy-tables";
import { probeLocation } from "@/lib/ai/analysis";
import { nutrientStatus } from "@/lib/crop-guides";
import { formatDay, fmtNum, plural } from "@/lib/format";
import type { FarmBundle, SensorDay } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = "bad" | "warn" | null;

interface Column {
  key: string;
  label: string;
  unit: string;
  group: "main" | "more";
  value: (s: SensorDay) => number | null;
  decimals: number;
  tone: (v: number | null) => Tone;
  /** Draw an in-cell bar, with a tick at this limit (null: bar without a limit). */
  bar?: { limit: number | null };
}

function columns(bundle: FarmBundle): Column[] {
  const limit = CROPS[bundle.farm.main_crop].salinity.threshold_dS_per_m;
  return [
    { key: "ece", label: "Salinity", unit: "dS/m", group: "main", value: (s) => s.ece, decimals: 1, tone: (v) => (v == null ? null : v > limit ? "bad" : v >= 0.85 * limit ? "warn" : null), bar: { limit } },
    { key: "moisture", label: "Moisture", unit: "%", group: "main", value: (s) => s.moisture, decimals: 1, tone: () => null, bar: { limit: null } },
    { key: "deficit", label: "Water used", unit: "% of reserve", group: "main", value: (s) => s.deficitPct, decimals: 0, tone: (v) => (v == null ? null : v > 100 ? "bad" : v >= 80 ? "warn" : null), bar: { limit: 100 } },
    { key: "yieldLoss", label: "Yield at risk", unit: "%", group: "main", value: (s) => s.yieldLoss, decimals: 0, tone: (v) => (v == null ? null : v >= 10 ? "bad" : v >= 2 ? "warn" : null), bar: { limit: 10 } },
    { key: "ph", label: "pH", unit: "", group: "more", value: (s) => s.ph, decimals: 1, tone: (v) => (v != null && v > 8.5 ? "warn" : null) },
    { key: "temperature", label: "Soil temp.", unit: "°C", group: "more", value: (s) => s.temperature, decimals: 1, tone: () => null },
    { key: "n", label: "N", unit: "mg/kg", group: "more", value: (s) => s.n, decimals: 0, tone: (v) => (nutrientStatus("n", v) === "low" ? "warn" : null) },
    { key: "p", label: "P", unit: "mg/kg", group: "more", value: (s) => s.p, decimals: 0, tone: (v) => (nutrientStatus("p", v) === "low" ? "warn" : null) },
    { key: "k", label: "K", unit: "mg/kg", group: "more", value: (s) => s.k, decimals: 0, tone: (v) => (nutrientStatus("k", v) === "low" ? "warn" : null) },
  ];
}

const TONE_TEXT: Record<Exclude<Tone, null>, string> = {
  bad: "font-semibold text-risk-high-ink",
  warn: "font-semibold text-risk-medium-ink",
};
const TONE_WORD: Record<Exclude<Tone, null>, string> = { bad: "at risk", warn: "watch" };

const BAR_FILL: Record<Exclude<Tone, null> | "ok", string> = {
  bad: "bg-risk-high/80",
  warn: "bg-risk-medium",
  ok: "bg-primary/35",
};

/** Each bar column's scale: the probes' largest value, or a little past the limit. */
type Scales = Record<string, { max: number; worst: number | null }>;

function scalesFor(cols: Column[], sensors: SensorDay[]): Scales {
  const out: Scales = {};
  for (const c of cols) {
    const vals = sensors.map((s) => c.value(s)).filter((v): v is number => v != null && Number.isFinite(v));
    const top = vals.length ? Math.max(...vals) : null;
    out[c.key] = { max: Math.max(top ?? 0, (c.bar?.limit ?? 0) * 1.25, 1e-6), worst: top };
  }
  return out;
}

function Cell({ col, s, scale }: { col: Column; s: SensorDay; scale?: Scales[string] }) {
  const v = col.value(s);
  const tone = col.tone(v);
  // Only the worst reading in a column past a threshold is written in colour; the bars carry the rest.
  const loud = tone != null && (!col.bar || (scale?.worst != null && v === scale.worst));
  const text = (
    <span className={cn("tabular", loud && tone && TONE_TEXT[tone])}>
      {fmtNum(v, col.decimals)}
      {tone ? <span className="sr-only"> ({TONE_WORD[tone]})</span> : null}
    </span>
  );
  if (!col.bar || !scale || v == null) return text;
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / scale.max) * 100))}%`;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="relative h-1.5 w-12 shrink-0 overflow-visible rounded-full bg-muted" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", BAR_FILL[tone ?? "ok"])} style={{ width: pct(v) }} />
        {col.bar.limit != null ? <span className="absolute -inset-y-1 w-px bg-foreground/55" style={{ left: pct(col.bar.limit) }} /> : null}
      </span>
      <span className="min-w-8 text-right">{text}</span>
    </span>
  );
}

export function DayStepper({ dates, index, onIndex, lastIndex }: { dates: string[]; index: number; onIndex: (i: number) => void; lastIndex: number }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" className="size-11 sm:size-9" aria-label="Previous day" disabled={index <= 0} onClick={() => onIndex(index - 1)}>
        <ChevronLeft />
      </Button>
      <span className="min-w-28 text-center text-sm font-semibold tabular" aria-live="polite">
        {index === lastIndex ? "Today" : formatDay(dates[index])}
      </span>
      <Button variant="outline" size="icon" className="size-11 sm:size-9" aria-label="Next day" disabled={index >= lastIndex} onClick={() => onIndex(index + 1)}>
        <ChevronRight />
      </Button>
      {index !== lastIndex ? (
        <Button variant="ghost" className="h-11 sm:h-9" onClick={() => onIndex(lastIndex)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}

export function ProbesPanel({
  bundle,
  dates,
  index,
  onIndex,
  lastIndex,
  showMore,
  onShowMore,
}: {
  bundle: FarmBundle;
  dates: string[];
  index: number;
  onIndex: (i: number) => void;
  lastIndex: number;
  showMore: boolean;
  onShowMore: (on: boolean) => void;
}) {
  const switchId = useId();
  const day = bundle.days[index];
  const cols = columns(bundle).filter((c) => showMore || c.group === "main");
  const main = cols.filter((c) => c.group === "main");
  const more = cols.filter((c) => c.group === "more");
  const sensors = day ? [...day.sensors].sort((a, b) => a.id.localeCompare(b.id)) : [];
  const saltiest = sensors.reduce<SensorDay | null>((top, s) => (s.ece != null && (top?.ece == null || s.ece > top.ece) ? s : top), null);
  const scales = scalesFor(cols, sensors);

  return (
    <section aria-labelledby="probes-title" className="rounded-2xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b p-4 sm:px-6">
        <div className="mr-auto">
          <h2 id="probes-title" className="text-base font-semibold">
            Probes
          </h2>
          <p className="text-sm text-muted-foreground">Daily means · {plural(sensors.length, "probe")}</p>
        </div>
        <label htmlFor={switchId} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium sm:min-h-9">
          <Switch id={switchId} checked={showMore} onCheckedChange={onShowMore} />
          Nutrients &amp; pH
        </label>
        <DayStepper dates={dates} index={index} onIndex={onIndex} lastIndex={lastIndex} />
      </div>

      {sensors.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No probe readings on {formatDay(dates[index])}.</p>
      ) : (
        <>
          {/* Phones: a card per probe */}
          <ul className="divide-y sm:hidden">
            {sensors.map((s) => (
              <li key={s.id} className="px-4 py-4">
                <p className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">{s.id}</span>
                  <span className="text-muted-foreground">{probeLocation(bundle, s.id)}</span>
                  {s === saltiest ? <span className="ml-auto rounded-full bg-risk-high-soft px-2 py-0.5 text-xs font-semibold text-risk-high-ink">Saltiest</span> : null}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  {cols.map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-2 text-sm">
                      <dt className="text-muted-foreground">
                        {c.label}
                        {c.unit ? <span className="text-xs"> {c.unit === "% of reserve" ? "%" : c.unit}</span> : null}
                      </dt>
                      <dd>
                        <Cell col={c} s={s} scale={scales[c.key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table with column groups */}
          <div className="relative hidden overflow-x-auto sm:block">
            <table className="w-full border-separate border-spacing-0 text-sm tabular">
              <caption className="sr-only">Probe readings (daily means) on {formatDay(dates[index])}</caption>
              <thead>
                {more.length ? (
                  <tr className="text-left text-xs text-muted-foreground">
                    <td className="px-6 pt-3" />
                    <th scope="colgroup" colSpan={main.length} className="px-4 pt-3 text-right font-semibold">
                      Salinity &amp; water
                    </th>
                    <th scope="colgroup" colSpan={more.length} className="border-l px-4 pt-3 text-right font-semibold">
                      Nutrients &amp; pH
                    </th>
                  </tr>
                ) : null}
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="border-b px-6 py-3 text-sm font-semibold">
                    Probe
                  </th>
                  {cols.map((c, i) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn("border-b px-4 py-3 text-right text-sm font-semibold whitespace-nowrap", c.group === "more" && more[0] === c && "border-l", i === cols.length - 1 && "pr-6")}
                    >
                      {c.label}
                      <span className="block text-xs font-normal">{c.unit || " "}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensors.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/40">
                    <th scope="row" className="border-b px-6 py-3 text-left font-semibold whitespace-nowrap">
                      {s.id}
                      <span className="ml-2 font-normal text-muted-foreground">{probeLocation(bundle, s.id)}</span>
                      {s === saltiest ? <span className="ml-2 rounded-full bg-risk-high-soft px-2 py-0.5 text-xs font-semibold text-risk-high-ink">Saltiest</span> : null}
                    </th>
                    {cols.map((c, i) => (
                      <td key={c.key} className={cn("border-b px-4 py-3 text-right whitespace-nowrap", c.group === "more" && more[0] === c && "border-l", i === cols.length - 1 && "pr-6")}>
                        <Cell col={c} s={s} scale={scales[c.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground sm:px-6">
            Salinity is ECe estimated from bulk EC with this farm&apos;s calibration. Bars compare the probes; the tick marks the crop&apos;s salt
            limit, a full reserve, or 10% yield loss. Red and amber bars are past a risk or watch threshold; nutrient ranges are indicative.
          </p>
        </>
      )}
    </section>
  );
}
