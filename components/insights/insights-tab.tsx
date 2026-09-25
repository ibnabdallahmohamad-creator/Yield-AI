"use client";

import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Info, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnswerSections } from "@/components/dashboard/answer-sections";
import { InfoTip } from "@/components/dashboard/info-tip";
import { Button } from "@/components/ui/button";
import { useJson } from "@/hooks/use-json";
import { useNow } from "@/hooks/use-now";
import type { AnalysisResponse, ChatAnswerSource } from "@/lib/ai/contract";
import { CROPS } from "@/lib/agronomy-tables";
import { farmAnalytics, TREND_DAYS, type Correlation, type FarmAnalytics, type MetricTrend, type ProbeSpread } from "@/lib/analytics";
import { addDays } from "@/lib/data/time";
import { formatShortDay, relativeTime } from "@/lib/format";
import { METRICS } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

const INK = "oklch(0.24 0.026 155)";
const ACCENT = "#2a78d6";
const THRESHOLD = "oklch(0.5 0.17 27)";
const GRID_STROKE = "oklch(0.3 0.02 120 / 0.1)";
const AXIS_TICK = { fontSize: 11, fill: "oklch(0.47 0.025 115)" };

const SOURCE_LABEL: Record<ChatAnswerSource, string> = {
  "ai-service": "Yield AI model",
  llm: "Claude · LLM fallback",
  offline: "Built-in agronomy engine",
};

const fmt = (v: number | null | undefined, d: number) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const unitOf = (unit: string) => (unit === "pH" ? "" : ` ${unit}`);

// ---------------------------------------------------------------------------
// AI analysis
// ---------------------------------------------------------------------------

function useAnalysis(farmId: string) {
  const [nonce, setNonce] = useState(0);
  // A regenerate asks the server to skip its 30-minute cache.
  const url = `/api/analysis?farm=${encodeURIComponent(farmId)}${nonce ? "&refresh=1" : ""}`;
  const result = useJson<AnalysisResponse>(url, nonce, (prev) => prev.startsWith(`/api/analysis?farm=${encodeURIComponent(farmId)}`));
  return { ...result, regenerate: () => setNonce((n) => n + 1) };
}

// ---------------------------------------------------------------------------
// Analytics pieces
// ---------------------------------------------------------------------------

const TONE: Record<FarmAnalytics["highlights"][number]["tone"], { icon: typeof Info; className: string; label: string }> = {
  bad: { icon: TriangleAlert, className: "border-risk-high/30 bg-risk-high-soft text-risk-high-ink", label: "Problem" },
  warn: { icon: AlertTriangle, className: "border-risk-medium/40 bg-risk-medium-soft text-risk-medium-ink", label: "Watch" },
  info: { icon: Info, className: "border-border bg-card", label: "Note" },
  good: { icon: CheckCircle2, className: "border-risk-low/30 bg-risk-low-soft text-risk-low-ink", label: "Good" },
};

function Sparkline({ values, className }: { values: Array<number | null>; className?: string }) {
  const known = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (known.length < 2) return <div className={className} />;
  const w = 120;
  const h = 32;
  const lo = Math.min(...known.map(([, v]) => v));
  const hi = Math.max(...known.map(([, v]) => v));
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => (hi - lo < 1e-9 ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6));
  const d = known.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [li, lv] = known[known.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(li)} cy={y(lv)} r={2.75} fill={ACCENT} stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}

function TrendTile({ trend }: { trend: MetricTrend }) {
  const m = METRICS[trend.key];
  const slope = trend.slopePerDay;
  const steady = slope == null || trend.r2 == null || trend.r2 < 0.3 || (trend.mean30 != null && Math.abs(slope * 14) < Math.abs(trend.mean30) * 0.02);
  const Arrow = steady ? ArrowRight : slope! > 0 ? ArrowUpRight : ArrowDownRight;
  const bad = !steady && m.higherIsWorse != null && (slope! > 0) === m.higherIsWorse;
  const good = !steady && m.higherIsWorse != null && !bad;
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card px-3 py-2.5 shadow-xs">
      <div className="flex items-center gap-1.5">
        <p className="truncate text-[12px] font-medium text-muted-foreground">{m.label}</p>
        {trend.anomaly ? (
          <span className="ml-auto rounded-full bg-risk-medium-soft px-1.5 py-px text-[10.5px] font-bold text-risk-medium-ink" title={`${fmt(trend.zScore, 1)} σ from its trend`}>
            Unusual
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-end gap-2">
        <p className="text-[20px] leading-none font-semibold">
          {fmt(trend.latest, m.decimals)}
          <span className="text-[12px] font-medium text-muted-foreground">{unitOf(m.unit)}</span>
        </p>
        <Sparkline values={trend.spark.map((s) => s.value)} className="ml-auto h-8 w-24 shrink-0" />
      </div>
      <p
        className={cn(
          "mt-1.5 inline-flex items-center gap-1 text-[12px]",
          bad ? "text-risk-high-ink" : good ? "text-risk-low-ink" : "text-muted-foreground",
        )}
      >
        <Arrow className="size-3.5 shrink-0" aria-hidden="true" />
        {steady ? "Steady" : `${slope! > 0 ? "+" : "−"}${fmt(Math.abs(slope!), m.decimals + 1)}${unitOf(m.unit)}/day`}
        <span className="text-muted-foreground">· 30-day mean {fmt(trend.mean30, m.decimals)}</span>
      </p>
    </div>
  );
}

function SalinityOutlookChart({ bundle, analytics }: { bundle: FarmBundle; analytics: FarmAnalytics }) {
  const s = analytics.salinity;
  const rows = useMemo(() => {
    if (!s || !analytics.asOf) return [];
    const trend = analytics.trends.find((t) => t.key === "ece");
    const past = (trend?.spark ?? []).map((p) => ({ date: p.date, actual: p.value, projected: null as number | null }));
    const last = past.at(-1);
    if (last) last.projected = last.actual;
    const future = Array.from({ length: 30 }, (_, i) => ({
      date: addDays(analytics.asOf!, i + 1),
      actual: null as number | null,
      projected: Math.max(0, s.latest + s.slopePerDay * (i + 1)),
    }));
    return [...past, ...future];
  }, [s, analytics]);
  if (!s) return null;
  const crop = CROPS[bundle.farm.main_crop];
  return (
    <section aria-labelledby="salinity-outlook" className="min-w-0 rounded-xl border bg-card p-3 shadow-xs">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 id="salinity-outlook" className="text-[13.5px] font-semibold">
          Salinity outlook <span className="font-normal text-muted-foreground">· ECe, dS/m</span>
        </h4>
        <InfoTip label="How the outlook is projected">
          A least-squares line through the last {TREND_DAYS} days of ECe (R² {fmt(s.r2, 2)}), extended 30 days. Yield loss from the Maas–Hoffman
          model ({crop.salinity.source}). A projection, not a forecast: leaching or rain changes it.
        </InfoTip>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="16" y2="2" stroke={INK} strokeWidth="2" />
          </svg>
          Measured
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="16" y2="2" stroke={INK} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Projected at the current trend
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="16" y2="2" stroke={THRESHOLD} strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>
          {crop.name} threshold {s.threshold} dS/m
        </span>
      </div>
      <div className="h-[200px]" role="img" aria-label={`ECe measured over 30 days and projected 30 days ahead: ${fmt(s.latest, 1)} now, ${fmt(s.ece30, 1)} dS/m in 30 days`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="date" tickFormatter={(d: string) => formatShortDay(d)} tick={AXIS_TICK} tickLine={false} minTickGap={24} axisLine={{ stroke: "oklch(0.3 0.02 120 / 0.2)" }} />
            <YAxis domain={[0, "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={34} />
            <ReferenceLine y={s.threshold} stroke={THRESHOLD} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />
            {analytics.asOf ? <ReferenceLine x={analytics.asOf} stroke="oklch(0.3 0.02 120 / 0.35)" label={{ value: "Today", position: "insideTopRight", fontSize: 10.5, fill: "oklch(0.47 0.025 115)" }} /> : null}
            <Line dataKey="actual" stroke={INK} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="projected" stroke={INK} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as { date: string; actual: number | null; projected: number | null } | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-lg border bg-card px-2.5 py-1.5 text-[12px] shadow-lg tabular">
                    <p className="font-semibold">{formatShortDay(row.date)}</p>
                    <p>{row.actual != null ? `Measured ${fmt(row.actual, 2)} dS/m` : `Projected ${fmt(row.projected, 2)} dS/m`}</p>
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">ECe now</dt>
          <dd className="font-semibold tabular">{fmt(s.latest, 2)} dS/m</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">In 30 days</dt>
          <dd className="font-semibold tabular">{fmt(s.ece30, 2)} dS/m</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Yield loss now → 30 d</dt>
          <dd className="font-semibold tabular">
            {fmt(s.yieldLossNow, 0)}% → {fmt(s.yieldLoss30, 0)}%
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reaches threshold</dt>
          <dd className="font-semibold tabular">{s.latest >= s.threshold ? "Already above" : s.daysToThreshold != null ? `in ~${fmt(s.daysToThreshold, 0)} days` : "Not at this trend"}</dd>
        </div>
      </dl>
    </section>
  );
}

function SpreadRow({ spread }: { spread: ProbeSpread }) {
  const m = METRICS[spread.key];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 text-[12.5px]">
        <span className="font-medium">{m.label}</span>
        <span className="ml-auto text-muted-foreground tabular">CV {fmt(spread.cvPct, 0)}%</span>
      </div>
      <div className="relative h-5">
        <div className="absolute inset-x-2 top-1/2 h-px bg-border" aria-hidden="true" />
        <span className="absolute top-1/2 left-2 size-3 -translate-y-1/2 rounded-full border-2 border-card bg-[#2a78d6]" title={`${spread.low.id}: ${fmt(spread.low.value, m.decimals)}`} />
        <span className="absolute top-1/2 right-2 size-3 -translate-y-1/2 rounded-full border-2 border-card bg-[#eb6834]" title={`${spread.high.id}: ${fmt(spread.high.value, m.decimals)}`} />
      </div>
      <div className="flex justify-between text-[11.5px] text-muted-foreground tabular">
        <span>
          Lowest {spread.low.id} · {fmt(spread.low.value, m.decimals)}
          {unitOf(m.unit)}
        </span>
        <span>
          Highest {spread.high.id} · {fmt(spread.high.value, m.decimals)}
          {unitOf(m.unit)}
        </span>
      </div>
    </div>
  );
}

function strength(r: number): string {
  const a = Math.abs(r);
  return a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "no clear";
}

function CorrelationRow({ c }: { c: Correlation }) {
  const a = METRICS[c.a];
  const b = METRICS[c.b];
  const width = Math.round(Math.abs(c.r) * 100);
  return (
    <li className="space-y-1">
      <p className="flex items-baseline gap-2 text-[12.5px]">
        <span className="font-medium">
          {a.short} vs {b.short}
        </span>
        <span className="ml-auto font-semibold tabular">r = {c.r >= 0 ? "" : "−"}{fmt(Math.abs(c.r), 2)}</span>
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: c.r >= 0 ? "#2a78d6" : "#eb6834" }} />
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        {strength(c.r) === "no clear"
          ? `No clear link over ${c.n} days.`
          : `${strength(c.r)[0].toUpperCase()}${strength(c.r).slice(1)} ${c.r > 0 ? "positive" : "negative"} link over ${c.n} days: they ${c.r > 0 ? "rise and fall together" : "move in opposite directions"}.`}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function InsightsTab({ bundle, dates }: { bundle: FarmBundle; dates: string[] }) {
  const { farm } = bundle;
  const analytics = useMemo(() => farmAnalytics(bundle, dates), [bundle, dates]);
  const analysis = useAnalysis(farm.id);
  const now = useNow();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold">AI insights · {farm.name}</h2>
        <span className="text-[12.5px] text-muted-foreground">
          {analytics.asOf ? `Readings up to ${formatShortDay(analytics.asOf)}` : "No readings yet"}
        </span>
      </div>

      {/* Key findings */}
      {analytics.highlights.length > 0 ? (
        <section aria-labelledby="findings" className="space-y-2">
          <h3 id="findings" className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
            Key findings
          </h3>
          <ul className="grid gap-2 lg:grid-cols-2">
            {analytics.highlights.map((h) => {
              const t = TONE[h.tone];
              return (
                <li key={h.text} className={cn("flex gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] leading-snug", t.className)}>
                  <t.icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="sr-only">{t.label}: </span>
                    {h.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* The model's analysis */}
      <section aria-labelledby="ai-analysis" className="space-y-3 rounded-2xl border bg-sidebar/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
            <Sparkles className="size-3.5" />
          </span>
          <h3 id="ai-analysis" className="text-[15px] font-semibold">
            Farm analysis
          </h3>
          <InfoTip label="Where the analysis comes from">
            The fine-tuned Yield AI model writes it when AI_SERVICE_URL is set (then Claude, then the built-in engine), from this farm&apos;s readings,
            FAO-56 / FAO-29 values and the 12-hour forecast. The answer is split into these sections by fixed rules — no second AI call.
          </InfoTip>
          {analysis.data ? (
            <span className="text-[12px] text-muted-foreground">
              {SOURCE_LABEL[analysis.data.source]}
              {analysis.data.source === "llm" && analysis.data.model ? ` (${analysis.data.model})` : ""} · {now ? relativeTime(analysis.data.created_at, now) : ""}
            </span>
          ) : null}
          <Button variant="outline" size="sm" className="ml-auto" onClick={analysis.regenerate} disabled={analysis.loading}>
            {analysis.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {analysis.data ? "Regenerate" : "Analyse"}
          </Button>
        </div>
        {analysis.data ? (
          <AnswerSections sections={analysis.data.sections} className={cn("transition-opacity", analysis.loading && "opacity-60")} />
        ) : analysis.loading ? (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Writing the analysis">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn("h-28 animate-pulse rounded-xl bg-card", i === 0 && "md:col-span-2")} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{analysis.error}</p>
        )}
      </section>

      {/* Numbers */}
      {analytics.trends.length > 0 ? (
        <>
          <section aria-labelledby="trends-14" className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 id="trends-14" className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
                Trends · last 30 days
              </h3>
              <InfoTip label="How trends are measured">
                Arrows show the least-squares slope over the last {TREND_DAYS} days (steady when the fit is weak or the change is under 2%). “Unusual”
                marks a day at least 3 standard deviations off its own trend.
              </InfoTip>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
              {analytics.trends.map((t) => (
                <TrendTile key={t.key} trend={t} />
              ))}
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-2">
            <SalinityOutlookChart bundle={bundle} analytics={analytics} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <section aria-labelledby="probe-spread" className="space-y-3 rounded-xl border bg-card p-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <h4 id="probe-spread" className="text-[13.5px] font-semibold">
                    Probe agreement
                  </h4>
                  <InfoTip label="About probe agreement">
                    Coefficient of variation across probes on the latest day. Above ~20% the field is uneven — often irrigation uniformity.
                  </InfoTip>
                </div>
                {analytics.spread.length ? (
                  analytics.spread.map((s) => <SpreadRow key={s.key} spread={s} />)
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">Needs at least two probes.</p>
                )}
              </section>
              <section aria-labelledby="correlations" className="space-y-3 rounded-xl border bg-card p-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <h4 id="correlations" className="text-[13.5px] font-semibold">
                    What moves together
                  </h4>
                  <InfoTip label="About correlations">Pearson correlation of daily farm means over the last 30 days. Correlation is not cause.</InfoTip>
                </div>
                {analytics.correlations.length ? (
                  <ul className="space-y-3">
                    {analytics.correlations.map((c) => (
                      <CorrelationRow key={`${c.a}-${c.b}`} c={c} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">Needs at least 5 days of readings.</p>
                )}
              </section>
              <section aria-labelledby="data-quality" className="space-y-2 rounded-xl border bg-card p-3 shadow-xs sm:col-span-2 xl:col-span-1 2xl:col-span-2">
                <h4 id="data-quality" className="text-[13.5px] font-semibold">
                  Data behind this
                </h4>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
                  <span>
                    <span className="font-semibold tabular">{analytics.quality.probesReporting}</span>
                    <span className="text-muted-foreground"> of {analytics.quality.probesTotal} probes reporting</span>
                  </span>
                  <span>
                    <span className="font-semibold tabular">{analytics.quality.daysWithData30}</span>
                    <span className="text-muted-foreground"> of the last 30 days with readings</span>
                  </span>
                </div>
                <div className="flex h-16 items-end gap-1.5" role="img" aria-label={`Readings per day: ${analytics.quality.readings7.map((r) => `${formatShortDay(r.date)} ${r.count}`).join(", ")}`}>
                  {(() => {
                    const max = Math.max(1, ...analytics.quality.readings7.map((r) => r.count));
                    return analytics.quality.readings7.map((r) => (
                      <div key={r.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <div className="w-full max-w-6 rounded-t-[4px] bg-[#2a78d6]" style={{ height: `${Math.max(2, (r.count / max) * 44)}px`, opacity: r.count ? 1 : 0.25 }} title={`${r.count} readings`} />
                        <span className="text-[10px] text-muted-foreground tabular">{formatShortDay(r.date).split(" ")[0]}</span>
                      </div>
                    ));
                  })()}
                </div>
                <p className="text-[11.5px] text-muted-foreground">Readings per day, last 7 days</p>
              </section>
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed p-5 text-center text-[13px] text-muted-foreground">
          Trends and statistics appear once the farm&apos;s probes have reported.
        </p>
      )}
    </div>
  );
}
