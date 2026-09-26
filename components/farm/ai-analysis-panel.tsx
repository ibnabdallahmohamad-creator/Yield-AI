"use client";

/**
 * Farm → AI analysis: the fine-tuned Harvestar AI model's answer, section by section, in the order
 * and places lib/ai/model-output.ts SECTION_LAYOUT gives them — and beside it the model's nine
 * inputs with their units (ESP32 soil moisture, live weather, site), so it's clear what it read.
 * When the model API isn't configured or doesn't answer, the built-in engine writes the same
 * sections in the same format, and the page says so.
 */
import {
  BookOpen,
  Bot,
  CalendarDays,
  CircleAlert,
  Coins,
  Cpu,
  ExternalLink,
  Lightbulb,
  ListChecks,
  RefreshCw,
  Send,
  Sprout,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FarmAnalysisResult } from "@/lib/ai/analysis-types";
import type { HealthTone } from "@/lib/dashboard";
import type { ModelOutput } from "@/lib/dataset/schema";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";
const H2 = "flex items-center gap-2 text-base font-semibold";
const MUTED = "text-sm leading-relaxed text-pretty text-muted-foreground";

const SEVERITY: Record<ModelOutput["warnings"][number]["severity"], { word: string; tone: HealthTone }> = {
  critical: { word: "Act now", tone: "bad" },
  warning: { word: "Warning", tone: "warn" },
  watch: { word: "Watch", tone: "none" },
};
const PRIORITY: Record<ModelOutput["recommendations"][number]["priority"], { word: string; cls: string }> = {
  high: { word: "High", cls: "bg-destructive/10 text-destructive" },
  medium: { word: "Medium", cls: "bg-amber-500/15 text-amber-800" },
  low: { word: "Low", cls: "bg-muted text-muted-foreground" },
};
const DAY_LEVEL: Record<ModelOutput["forecast"]["days"][number]["level"], { word: string; cls: string; tone: HealthTone }> = {
  ok: { word: "Fine", cls: "border-emerald-600/25 bg-emerald-600/5", tone: "ok" },
  watch: { word: "Watch", cls: "border-border bg-muted/40", tone: "none" },
  warning: { word: "Warning", cls: "border-amber-500/40 bg-amber-500/10", tone: "warn" },
};
const HARVEST_WORD: Record<string, string> = {
  establishing: "Establishing",
  growing: "Growing",
  harvesting: "Harvesting",
  ending: "Last pickings",
  cutting: "Cutting cycle",
};

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; result: FarmAnalysisResult };

async function fetchAnalysis(farmId: string, question?: string, fresh = false): Promise<FarmAnalysisResult> {
  const res = question
    ? await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ farm_id: farmId, question }) })
    : await fetch(`/api/analysis?farm=${encodeURIComponent(farmId)}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (FarmAnalysisResult & { error?: string }) | null;
  if (!res.ok || !body || body.error) throw new Error(body?.error ?? `The analysis failed (HTTP ${res.status}).`);
  return body;
}

export function AiAnalysisPanel({ farmId }: { farmId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);

  const load = useCallback(
    async (q?: string, fresh = false) => {
      const id = ++seq.current;
      setBusy(true);
      if (!q) setState((s) => (s.status === "ready" ? s : { status: "loading" }));
      try {
        const result = await fetchAnalysis(farmId, q, fresh);
        if (id === seq.current) setState({ status: "ready", result });
      } catch (error) {
        if (id === seq.current) setState({ status: "error", message: error instanceof Error ? error.message : "The analysis failed." });
      } finally {
        if (id === seq.current) setBusy(false);
      }
    },
    [farmId],
  );

  // First load: state starts as "loading", so only the async callbacks set state.
  useEffect(() => {
    const id = ++seq.current;
    fetchAnalysis(farmId).then(
      (result) => {
        if (id !== seq.current) return;
        setState({ status: "ready", result });
        setBusy(false);
      },
      (error: unknown) => {
        if (id !== seq.current) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "The analysis failed." });
        setBusy(false);
      },
    );
  }, [farmId]);

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q) void load(q);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-6" aria-busy={busy}>
      <section aria-labelledby="ai-heading" className={cn(CARD, "flex flex-col gap-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="ai-heading" className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="size-5 text-primary" aria-hidden="true" />
              AI analysis
            </h2>
            {state.status === "ready" ? <SourceLine result={state.result} /> : <p className={MUTED}>Reading this farm&apos;s probes and the weather…</p>}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load(undefined, true)} disabled={busy} aria-label="Run the analysis again">
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="ai-question" className="sr-only">
            Ask about this farm
          </label>
          <input
            id="ai-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="Ask the model about this farm, e.g. How much should I irrigate this week?"
            className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          <Button type="submit" className="h-10 px-4" disabled={busy || !question.trim()}>
            <Send className="size-4" aria-hidden="true" />
            Ask
          </Button>
        </form>
        {state.status === "ready" && state.result.question ? (
          <p className="text-sm">
            <span className="font-semibold text-muted-foreground">Q2 ·</span> {state.result.question}
          </p>
        ) : null}
      </section>

      {state.status === "loading" ? <LoadingCards /> : null}
      {state.status === "error" ? (
        <section className={cn(CARD, "flex items-start gap-3")} role="alert">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-semibold">The analysis couldn&apos;t be built</p>
            <p className={MUTED}>{state.message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load(undefined, true)}>
              Try again
            </Button>
          </div>
        </section>
      ) : null}
      {state.status === "ready" ? <Answer result={state.result} dim={busy} /> : null}
    </div>
  );
}

function SourceLine({ result }: { result: FarmAnalysisResult }) {
  const at = new Date(result.created_at).toLocaleString("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-1 space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {result.source === "model" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            <Bot className="size-3.5" aria-hidden="true" />
            Harvestar AI model · {result.model}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
            <Cpu className="size-3.5" aria-hidden="true" />
            Built-in engine · model format
          </span>
        )}
        <span className="tabular">As of {at} (Qatar)</span>
        {result.ms != null ? <span className="tabular">· {(result.ms / 1000).toFixed(1)} s</span> : null}
      </p>
      {result.source === "engine" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {result.model_error
            ? `The model didn't answer (${result.model_error}). The built-in engine wrote these sections from the same inputs, in the model's format.`
            : "The model API isn't connected yet (AI_MODEL_URL). Until it is, the built-in engine writes these sections from exactly the inputs the model will get, in its output format."}
        </p>
      ) : null}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" aria-label="Loading the analysis">
      <div className="grid gap-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

function Answer({ result, dim }: { result: FarmAnalysisResult; dim: boolean }) {
  const a = result.output;
  const sources = new Map(a.sources.map((s) => [s.id, s]));
  return (
    <div className={cn("grid grid-cols-1 items-start gap-4 transition-opacity lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]", dim && "opacity-60")}>
      <div className="grid grid-cols-1 gap-4 lg:gap-6">
        <section aria-labelledby="ai-answer" className={cn(CARD, "border-primary/30 bg-primary/[0.03]")}>
          <h2 id="ai-answer" className="text-xs font-semibold tracking-wide text-primary uppercase">
            Answer
          </h2>
          <p className="mt-2 text-base leading-relaxed text-pretty">{a.summary}</p>
        </section>

        <section aria-labelledby="ai-warnings" className={CARD}>
          <h2 id="ai-warnings" className={H2}>
            <TriangleAlert className="size-4 text-muted-foreground" aria-hidden="true" />
            Warnings
          </h2>
          {a.warnings.length === 0 ? (
            <p className={cn(MUTED, "mt-2")}>Nothing in the next 7 days needs attention.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {a.warnings.map((w, i) => (
                <li key={`${i}-${w.title}`} className="py-3 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <HealthDot tone={SEVERITY[w.severity].tone} className="ring-0" />
                    {SEVERITY[w.severity].word}
                    <span className="font-medium tracking-normal normal-case">· {w.when}</span>
                  </p>
                  <p className="mt-1 font-semibold text-pretty">{w.title}</p>
                  <p className={cn(MUTED, "mt-1")}>{w.detail}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty">
                    <span className="font-semibold">Do: </span>
                    {w.action}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ai-recs" className={CARD}>
          <h2 id="ai-recs" className={H2}>
            <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
            What to do
          </h2>
          <ol className="mt-3 space-y-3">
            {a.recommendations.map((r, i) => (
              <li key={`${i}-${r.action}`} className="flex gap-3">
                <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold text-muted-foreground tabular">{i + 1}.</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-pretty">{r.action}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY[r.priority].cls)}>{PRIORITY[r.priority].word}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{r.when}</span> · {r.why}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="ai-forecast" className={CARD}>
          <h2 id="ai-forecast" className={H2}>
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            Next 7 days
          </h2>
          <p className={cn(MUTED, "mt-2")}>{a.forecast.next_7_days}</p>
          <ol aria-label="Day by day" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {a.forecast.days.map((d) => (
              <li key={d.date} className={cn("flex flex-col gap-1 rounded-xl border p-2.5", DAY_LEVEL[d.level].cls)}>
                <span className="flex items-center justify-between gap-1 text-xs font-semibold tabular">
                  {formatDay(d.date)}
                  <HealthDot tone={DAY_LEVEL[d.level].tone} label={DAY_LEVEL[d.level].word} className="ring-0" />
                </span>
                <span className="text-xs leading-snug text-pretty text-muted-foreground">{d.label}</span>
              </li>
            ))}
          </ol>
          <dl className="mt-4 grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Season ahead</dt>
              <dd className={MUTED}>{a.forecast.season_ahead}</dd>
            </div>
            <div>
              <dt className="font-semibold">Long term</dt>
              <dd className={MUTED}>{a.forecast.long_term}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="ai-insights" className={CARD}>
          <h2 id="ai-insights" className={H2}>
            <Lightbulb className="size-4 text-muted-foreground" aria-hidden="true" />
            Insights
          </h2>
          <ul className="mt-3 space-y-4">
            {a.insights.map((f, i) => (
              <li key={`${i}-${f.title}`}>
                <p className="text-sm font-semibold text-pretty">{f.title}</p>
                <p className={cn(MUTED, "mt-1")}>{f.detail}</p>
                {f.sources.length ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {f.sources.map((id) => {
                      const s = sources.get(id);
                      return s ? (
                        <a key={id} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                          {id}
                        </a>
                      ) : (
                        <span key={id} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          {id}
                        </span>
                      );
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <section aria-labelledby="ai-econ" className={CARD}>
            <h2 id="ai-econ" className={H2}>
              <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
              Economic analysis
            </h2>
            <p className={cn(MUTED, "mt-2")}>{a.economic_advice.summary}</p>
            <dl className="mt-3 divide-y">
              {a.economic_advice.figures.map((f, i) => (
                <div key={`${i}-${f.label}`} className="py-2">
                  <dt className="text-sm text-muted-foreground">{f.label}</dt>
                  <dd>
                    <span className="text-sm font-semibold tabular">{f.value}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{f.basis}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="mt-3 list-disc space-y-1 border-t pt-3 pl-4 text-sm leading-relaxed">
              {a.economic_advice.advice.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            {a.data_gaps.length ? (
              <div className="mt-3 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground">Data gaps</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                  {a.data_gaps.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="ai-crop" className={CARD}>
            <h2 id="ai-crop" className={H2}>
              <Sprout className="size-4 text-muted-foreground" aria-hidden="true" />
              Crop plan
            </h2>
            {a.crop_plan.harvest ? (
              <p className="mt-2 text-sm">
                <span className="font-semibold">{HARVEST_WORD[a.crop_plan.harvest.status] ?? a.crop_plan.harvest.status}</span>
                <span className="text-muted-foreground tabular">
                  {" "}
                  · harvest {formatDay(a.crop_plan.harvest.start)}
                  {a.crop_plan.harvest.end ? ` – ${formatDay(a.crop_plan.harvest.end)}` : ""}
                </span>
              </p>
            ) : null}
            <ol className="mt-3 space-y-3">
              {a.crop_plan.recommended.map((c, i) => (
                <li key={`${i}-${c.crop}`} className={cn("rounded-xl border p-3", i === 0 && "border-primary/40 bg-primary/[0.04]")}>
                  <p className="text-sm font-semibold">
                    {i === 0 ? "Go with: " : ""}
                    {c.crop} <span className="font-normal text-muted-foreground">· {c.farm_type}</span>
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">{c.when}</p>
                  <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">{c.why}</p>
                </li>
              ))}
            </ol>
            {a.crop_plan.avoid.length ? (
              <>
                <h3 className="mt-4 text-sm font-semibold text-muted-foreground">Avoid</h3>
                <ul className="mt-1 space-y-1.5">
                  {a.crop_plan.avoid.map((c) => (
                    <li key={c.crop} className="text-sm">
                      <span className="font-semibold">{c.crop}</span> <span className="text-muted-foreground">— {c.why}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>

        <section aria-labelledby="ai-sources" className={CARD}>
          <h2 id="ai-sources" className={H2}>
            <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
            Sources
          </h2>
          <ul className="mt-3 space-y-1.5">
            {a.sources.map((s) => (
              <li key={s.id} className="flex gap-2 text-sm">
                <span className="w-8 shrink-0 font-semibold text-muted-foreground">{s.id}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 text-pretty text-primary hover:underline">
                  {s.title}
                  <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ModelInputs result={result} />
    </div>
  );
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const numv = (v: unknown, unit = "", digits = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : "—");
const sum = (v: unknown) => (Array.isArray(v) ? v.reduce((a: number, x) => a + (typeof x === "number" ? x : 0), 0) : null);
const maxOf = (v: unknown) => (Array.isArray(v) && v.length ? Math.max(...v.filter((x): x is number => typeof x === "number")) : null);

/** The nine inputs as the model receives them, with units, plus the raw JSON in and out. */
function ModelInputs({ result }: { result: FarmAnalysisResult }) {
  const inp = result.input.inputs as Rec;
  const eco = obj(inp.ecosystem);
  const crops = (obj(inp.growable_crops).crops as Rec[] | undefined) ?? [];
  const t = obj(inp.air_temperature);
  const rh = obj(inp.relative_humidity);
  const wind = obj(inp.wind);
  const rain = obj(inp.rain);
  const soil = obj(inp.soil_moisture);
  const hasSurvey = typeof soil.mean_vwc_pct === "number";
  const rows: Array<[string, string, string]> = [
    ["1–2 · Location", `${numv(inp.latitude, "°", 4)} N, ${numv(inp.longitude, "°", 4)} E`, "Farm position"],
    ["3 · Ecosystem", String(eco.aridity_class ?? eco.type ?? "—"), `${String(eco.place ?? "")}${eco.municipality ? `, ${eco.municipality}` : ""}`],
    [
      "4 · Growable crops",
      crops
        .filter((c) => c.suitability === "good")
        .slice(0, 4)
        .map((c) => String(c.crop))
        .join(", ") || "—",
      `${crops.length} crops rated on this site's water`,
    ],
    ["5 · Air temperature", `${numv(t.today_max, " °C")} / ${numv(t.today_min, " °C")}`, `Today max / min · next 7 d up to ${numv(maxOf(t.next_7d_max), " °C")}`],
    ["6 · Relative humidity", `${numv(rh.today_max, " %", 0)} / ${numv(rh.today_min, " %", 0)}`, "Today max / min"],
    ["7 · Wind", `${numv(wind.today_mean, " m/s")} ${String(wind.today_direction ?? "")}`, `At 10 m · gusts to ${numv(wind.today_max, " m/s")} today`],
    ["8 · Rain", `${numv(rain.today, " mm")} today`, `${numv(sum(rain.next_7d), " mm")} next 7 d · ${numv(rain.past_30d, " mm")} past 30 d`],
    [
      "9 · Soil moisture",
      hasSurvey ? `${numv(soil.mean_vwc_pct, " % VWC")}` : "No recent reading",
      hasSurvey
        ? `ESP32 probes, 0–30 cm · range ${numv(soil.min_vwc_pct, "")}–${numv(soil.max_vwc_pct, " %")} · ${String(soil.readings)} readings · 7-day change ${numv(soil.change_7d_pct_points, " pts")} · ${String(soil.measured_at ?? "")}`
        : String(soil.status ?? ""),
    ],
  ];
  return (
    <aside aria-labelledby="ai-inputs" className="grid gap-4 lg:gap-6 xl:sticky xl:top-[7.5rem]">
      <section className={CARD}>
        <h2 id="ai-inputs" className={H2}>
          <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
          What the model read
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The nine inputs, in the units the model was trained on. Soil moisture comes from this farm&apos;s ESP32 probes (% volumetric water); weather from Open-Meteo.
        </p>
        <dl className="mt-3 divide-y">
          {rows.map(([label, value, detail]) => (
            <div key={label} className="py-2">
              <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular">{value}</dd>
              {detail ? <dd className="text-xs leading-relaxed text-muted-foreground">{detail}</dd> : null}
            </div>
          ))}
        </dl>
        {result.notes.length ? (
          <ul className="mt-3 list-disc space-y-1 border-t pt-3 pl-4 text-xs leading-relaxed text-muted-foreground">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
        <details className="mt-3 border-t pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Model input (JSON)</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-snug">{JSON.stringify(result.input, null, 2)}</pre>
        </details>
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Model output (JSON)</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-snug">{JSON.stringify(result.output, null, 2)}</pre>
        </details>
      </section>
    </aside>
  );
}
