"use client";

/**
 * Every reading of a farm on one chart (GET /api/readings/series): pick a metric and a window, drag
 * across the chart (or use +/−) to zoom down to single readings, switch to one line per probe. The
 * server buckets the readings so the chart stays fast whatever the reporting interval; a stats row,
 * a table view and a CSV download carry the same numbers. Refreshes itself when live readings arrive.
 */
import { Download, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { AXIS_TICK, C, Legend, niceScale, tickFormatter, TooltipRow, TooltipShell } from "@/components/charts/chart-kit";
import { useOptionalShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { NUTRIENT_GUIDE } from "@/lib/crop-guides";
import { formatShortDay, formatTime, fmtNum, qatarDay, relativeTime } from "@/lib/format";
import { SERIES_METRIC_DEFS, SERIES_METRICS, SERIES_RANGES, type ReadingSeries, type SeriesMetric } from "@/lib/readings/series";
import { cn } from "@/lib/utils";

/** Categorical slots in fixed order (validated: adjacent CVD ΔE ≥ 9.1 on the card surface). Probe → slot by its place in the farm's probe list. */
const PROBE_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
/** A metric's smallest y-span, so sensor noise doesn't fill the chart. */
const MIN_SPAN: Record<SeriesMetric, number> = { moisture: 4, temperature: 2, ec: 0.2, ph: 0.4, n: 10, p: 5, k: 10, air_temp: 2, air_humidity: 10 };

/** A reference range behind the chart, where one holds whatever the crop (nutrients, pH). */
function targetBand(metric: SeriesMetric): { y1: number; y2: number; label: string; legend: string } | null {
  if (metric === "n" || metric === "p" || metric === "k") return { y1: NUTRIENT_GUIDE[metric].low, y2: NUTRIENT_GUIDE[metric].high, label: "Adequate", legend: "Indicative adequate range" };
  if (metric === "ph") return { y1: 6.6, y2: 7.4, label: "Neutral", legend: "Neutral pH (6.6–7.4)" };
  return null;
}

const HIGH = "oklch(0.55 0.15 40)";
const HALO = { stroke: "var(--card)", strokeWidth: 3, paintOrder: "stroke" } as const;

type RangeKey = (typeof SERIES_RANGES)[number]["key"] | "all";
const RANGES: Array<{ key: RangeKey; label: string }> = [...SERIES_RANGES.map((r) => ({ key: r.key, label: r.label })), { key: "all", label: "All" }];

const QATAR_OFFSET = 3 * 3_600_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TICK_STEPS = [MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

const iso = (t: number) => new Date(t).toISOString();
const dayLabel = (t: number) => formatShortDay(qatarDay(iso(t)));

/** Up to six time ticks on round Qatar-time boundaries. */
function timeTicks(from: number, to: number): { ticks: number[]; step: number } {
  const span = Math.max(MINUTE, to - from);
  const step = TICK_STEPS.find((s) => span / s <= 6) ?? 30 * DAY;
  const first = Math.ceil((from + QATAR_OFFSET) / step) * step - QATAR_OFFSET;
  const ticks: number[] = [];
  for (let t = first; t <= to; t += step) ticks.push(t);
  return { ticks, step };
}

function tickLabel(t: number, step: number): string {
  if (step >= DAY) return dayLabel(t);
  const atMidnight = (t + QATAR_OFFSET) % DAY === 0;
  return atMidnight ? dayLabel(t) : formatTime(iso(t));
}

/** "14:05", or "12 Sep, 14:05" when the window spans days. */
function pointTime(t: number, multiDay: boolean): string {
  return multiDay ? `${dayLabel(t)}, ${formatTime(iso(t))}` : formatTime(iso(t));
}

function bucketText(seconds: number): string {
  if (seconds < 60) return `${seconds}-second`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}-minute`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}-hour`;
  return `${Math.round(seconds / 86400)}-day`;
}

interface Row {
  t: number;
  mean: number | null;
  band: [number, number] | null;
  n: number;
  [probe: `p${number}`]: number | null;
}

function toCsv(series: ReadingSeries): string {
  const metrics = SERIES_METRICS.filter((m) => series.metrics[m]);
  const head = ["time", ...metrics.flatMap((m) => [`${m}_mean`, `${m}_min`, `${m}_max`, `${m}_readings`])];
  const times = series.metrics[metrics[0]]?.points.map((p) => p[0]) ?? [];
  const lines = [head.join(",")];
  times.forEach((t, i) => {
    const cells = metrics.flatMap((m) => {
      const p = series.metrics[m]!.points[i];
      return p && p[4] > 0 ? [p[1], p[2], p[3], p[4]].map((v) => (v == null ? "" : String(v))) : ["", "", "", "0"];
    });
    if (cells.every((c) => c === "" || c === "0")) return;
    lines.push([iso(t), ...cells].join(","));
  });
  return lines.join("\n");
}

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-40 sm:h-8",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xl font-semibold">{value}</p>
      {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function ReadingsExplorer({ farmId, farmName, probeIds }: { farmId: string; farmName: string; probeIds: string[] }) {
  const shell = useOptionalShell();
  const [range, setRange] = useState<RangeKey>("24h");
  const [zoom, setZoom] = useState<{ from: number; to: number } | null>(null);
  const [metricChoice, setMetric] = useState<SeriesMetric>("moisture");
  const [byProbe, setByProbe] = useState(false);
  const [series, setSeries] = useState<ReadingSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Fetch whenever the window changes (or live readings ask for a refresh, quietly).
  const requestKey = `${farmId}|${zoom ? `${zoom.from}-${zoom.to}` : range}`;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const ctrl = new AbortController();
    const q = new URLSearchParams({ farm: farmId });
    if (zoom) {
      q.set("from", iso(zoom.from));
      q.set("to", iso(zoom.to));
    } else q.set("range", range);
    fetch(`/api/readings/series?${q.toString()}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as ReadingSeries & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
        setSeries(body);
        setError(null);
        setNow(Date.now());
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load the readings.");
        setLoadedKey(requestKey);
      });
    return () => ctrl.abort();
  }, [farmId, range, zoom, reloadKey, requestKey]);

  // New live readings for this farm → refetch (at most every 5 s), unless the user is zoomed into the past.
  const lastReload = useRef(0);
  const subscribe = shell?.subscribeLive;
  useEffect(() => {
    if (!subscribe || zoom) return;
    return subscribe((update) => {
      if (!update.readings.some((r) => r.farm_id === farmId) && !update.farms[farmId]) return;
      if (Date.now() - lastReload.current < 5000) return;
      lastReload.current = Date.now();
      setReloadKey((k) => k + 1);
    });
  }, [subscribe, farmId, zoom]);

  const available = useMemo(() => SERIES_METRICS.filter((m) => series?.metrics[m]), [series]);
  const metric: SeriesMetric = series?.metrics[metricChoice] || available.length === 0 ? metricChoice : available[0];
  const def = SERIES_METRIC_DEFS[metric];
  const data = series?.metrics[metric] ?? null;

  // Probe colours follow the probe (its place in the farm's list), never its rank in this window.
  const probeSlot = useMemo(() => {
    const all = [...probeIds, ...(series?.sensors ?? []).filter((s) => !probeIds.includes(s))];
    return new Map(all.map((id, i) => [id, i]));
  }, [probeIds, series]);
  const shownProbes = useMemo(() => (series?.sensors ?? []).filter((s) => (probeSlot.get(s) ?? 99) < PROBE_PALETTE.length), [series, probeSlot]);
  const foldedProbes = (series?.sensors.length ?? 0) - shownProbes.length;

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    return data.points.map((p, i) => {
      const row: Row = { t: p[0], mean: p[1], band: p[2] != null && p[3] != null ? [p[2], p[3]] : null, n: p[4] };
      for (const s of shownProbes) row[`p${probeSlot.get(s) ?? 0}`] = data.bySensor[s]?.[i] ?? null;
      return row;
    });
  }, [data, shownProbes, probeSlot]);

  const fromMs = series ? Date.parse(series.from) : now - DAY;
  const toMs = series ? Date.parse(series.to) : now;
  // Show dates with times when the window spans days or isn't today.
  const multiDay = toMs - fromMs > 20 * HOUR || qatarDay(iso(fromMs)) !== qatarDay(iso(toMs)) || qatarDay(iso(toMs)) !== qatarDay(iso(now));
  const { ticks, step } = timeTicks(fromMs, toMs);
  const scale = niceScale(
    rows.flatMap((r) => (byProbe ? shownProbes.map((s) => r[`p${probeSlot.get(s) ?? 0}`]) : [r.band?.[0], r.band?.[1], r.mean])),
    { minSpan: MIN_SPAN[metric], zero: metric === "n" || metric === "p" || metric === "k", atMost: metric === "air_humidity" || metric === "moisture" ? 100 : undefined },
  );
  const bucketS = series?.bucket_s ?? 0;
  const markDots = rows.filter((r) => r.mean != null).length <= 48;
  const unit = !def.unit ? "" : def.unit.startsWith("%") ? "%" : ` ${def.unit}`;
  const fmt = (v: number | null | undefined, d = def.decimals) => (v == null ? "—" : `${fmtNum(v, d)}${unit}`);

  const changeText = (change: number | null) => {
    if (change == null) return "—";
    const shown = fmt(Math.abs(change));
    // A change that rounds to zero has no sign.
    if (Math.abs(change) < 0.5 * 10 ** -def.decimals) return fmt(0);
    return `${change > 0 ? "+" : "−"}${shown}`;
  };

  const pickRange = (key: RangeKey) => {
    setZoom(null);
    setRange(key);
  };
  const zoomBy = (factor: number) => {
    const mid = (fromMs + toMs) / 2;
    const half = Math.max(5 * MINUTE, ((toMs - fromMs) * factor) / 2);
    const end = Math.min(Date.now(), mid + half);
    setZoom({ from: end - 2 * half, to: end });
  };

  const downloadCsv = useCallback(() => {
    if (!series) return;
    const blob = new Blob([toCsv(series)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${farmName.replace(/[^\w-]+/g, "-").toLowerCase()}-readings-${qatarDay(series.from)}-to-${qatarDay(series.to)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [series, farmName]);

  const summary = data?.summary ?? null;
  const band = targetBand(metric);
  // Off the chart (pH 8 soil against a neutral 6.6–7.4): the legend says which way instead.
  const bandSide = !band ? null : band.y2 <= scale.domain[0] ? "below" : band.y1 >= scale.domain[1] ? "above" : null;
  // The window's highest and lowest single readings, labelled on the chart (the label turns inward near an edge).
  const extremes =
    summary?.min && summary.max && summary.max.value > summary.min.value
      ? (["max", "min"] as const).map((kind) => {
          const e = summary[kind]!;
          const f = (e.t - fromMs) / Math.max(1, toMs - fromMs);
          const position = f > 0.85 ? "left" : f < 0.15 ? "right" : kind === "max" ? "top" : "bottom";
          return { kind, ...e, position } as const;
        })
      : [];
  const empty = series != null && !data;
  const neverAny = empty && series.readings === 0 && range === "all" && !zoom;

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5" aria-labelledby={`readings-${farmId}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`readings-${farmId}`} className="text-base font-semibold">
          {def.label}
          {def.unit ? <span className="font-normal text-muted-foreground"> · {def.unit}</span> : null}
        </h2>
        <p className="text-sm text-muted-foreground">
          {series
            ? series.readings
              ? `${series.readings.toLocaleString("en")} readings from ${series.sensors.length} probe${series.sensors.length === 1 ? "" : "s"} · ${
                  series.raw ? "every reading shown" : `${bucketText(bucketS)} averages`
                }`
              : "No readings in this window"
            : "Loading…"}
        </p>
      </div>

      {/* Filters: one row above the chart. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time window">
          {RANGES.map((r) => (
            <Chip key={r.key} active={!zoom && range === r.key} onClick={() => pickRange(r.key)}>
              {r.label}
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-9" aria-label="Zoom in" onClick={() => zoomBy(0.5)} disabled={!series}>
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" className="size-9" aria-label="Zoom out" onClick={() => zoomBy(2)} disabled={!series}>
            <ZoomOut aria-hidden="true" />
          </Button>
          {zoom ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {pointTime(zoom.from, true)} – {qatarDay(iso(zoom.from)) === qatarDay(iso(zoom.to)) ? formatTime(iso(zoom.to)) : pointTime(zoom.to, true)}
            </span>
          ) : null}
          {zoom ? (
            <Button variant="outline" size="sm" className="h-9" onClick={() => setZoom(null)}>
              <RotateCcw aria-hidden="true" />
              Reset zoom
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" className="size-9" aria-label="Download CSV" onClick={downloadCsv} disabled={!series?.readings}>
            <Download aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="scrollbar-thin -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Metric">
        {SERIES_METRICS.map((m) => (
          <Chip key={m} active={metric === m} onClick={() => setMetric(m)} disabled={series != null && !series.metrics[m]}>
            {SERIES_METRIC_DEFS[m].short}
          </Chip>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Latest" value={fmt(summary.latest?.value)} sub={summary.latest ? `${relativeTime(iso(summary.latest.t), now)}` : null} />
          <Stat label="Average" value={fmt(summary.mean)} sub={`${summary.count.toLocaleString("en")} readings`} />
          <Stat label="Lowest" value={fmt(summary.min?.value)} sub={summary.min ? pointTime(summary.min.t, multiDay) : null} />
          <Stat label="Highest" value={fmt(summary.max?.value)} sub={summary.max ? pointTime(summary.max.t, multiDay) : null} />
          <Stat label="Change" value={changeText(summary.change)} sub="first to last point" />
          <Stat label="Probes" value={String(series?.sensors.length ?? 0)} sub={series?.last_reading ? `last ${formatTime(series.last_reading)}` : null} />
        </div>
      ) : null}

      <div className={cn("relative mt-4 transition-opacity", loading && series ? "opacity-60" : "")}>
        {empty || (!series && loading) ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 px-6 text-center text-sm text-muted-foreground">
            {!series ? (
              "Loading readings…"
            ) : neverAny ? (
              <>
                <p className="font-medium text-foreground">No readings yet</p>
                <p>Connect an ESP32 to this farm and its readings appear here within seconds.</p>
                <Button asChild size="sm" className="mt-1">
                  <Link href="/dashboard/devices">Connect an ESP32</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">No {def.label.toLowerCase()} readings in this window</p>
                <p>{series.last_reading ? `Last reading ${relativeTime(series.last_reading, now)}.` : "Try a longer window."}</p>
                {range !== "all" || zoom ? (
                  <Button size="sm" variant="outline" className="mt-1" onClick={() => pickRange("all")}>
                    Show everything
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div
            className="h-72 select-none sm:h-80 [&_.recharts-wrapper:focus:not(:focus-visible)]:outline-none"
            role="img"
            aria-label={`${def.label} for ${farmName}, ${pointTime(fromMs, true)} to ${pointTime(toMs, true)}${summary ? `: average ${fmt(summary.mean)}, lowest ${fmt(summary.min?.value)}, highest ${fmt(summary.max?.value)}` : ""}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                // A new window starts with a fresh hover state (live refreshes keep it).
                key={requestKey}
                data={rows}
                margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                onMouseDown={(s) => {
                  const t = Number(s?.activeLabel);
                  if (Number.isFinite(t)) setDrag({ a: t, b: t });
                }}
                onMouseMove={(s) => {
                  const t = Number(s?.activeLabel);
                  if (drag && Number.isFinite(t)) setDrag({ ...drag, b: t });
                }}
                onMouseUp={() => {
                  if (drag) {
                    const lo = Math.min(drag.a, drag.b);
                    const hi = Math.max(drag.a, drag.b) + bucketS * 1000;
                    if (hi - lo >= Math.max(2 * bucketS * 1000, MINUTE)) setZoom({ from: lo, to: Math.min(hi, Date.now()) });
                  }
                  setDrag(null);
                }}
                onMouseLeave={() => setDrag(null)}
              >
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[fromMs, toMs]}
                  ticks={ticks}
                  tickFormatter={(t: number) => tickLabel(t, step)}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                  height={28}
                  allowDataOverflow
                />
                <YAxis
                  domain={scale.domain}
                  ticks={scale.ticks}
                  allowDataOverflow
                  width={scale.decimals > 0 ? 44 : 38}
                  tick={AXIS_TICK}
                  tickFormatter={tickFormatter(scale.decimals)}
                  tickLine={false}
                  axisLine={false}
                />
                {band ? (
                  <ReferenceArea
                    y1={band.y1}
                    y2={band.y2}
                    fill={C.adequate}
                    fillOpacity={0.12}
                    stroke="none"
                    ifOverflow="hidden"
                    label={{ value: band.label, position: "insideTopLeft", fontSize: 12, fill: "oklch(0.45 0.1 152)" }}
                  />
                ) : null}
                {!byProbe ? <Area dataKey="band" stroke="none" fill={C.range} fillOpacity={0.22} isAnimationActive={false} activeDot={false} /> : null}
                {summary?.mean != null && rows.length > 2 ? (
                  <ReferenceLine
                    y={summary.mean}
                    stroke={C.axis}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{ value: `Average ${fmt(summary.mean)}`, position: "insideBottomRight", fontSize: 12, fill: C.axis, ...HALO }}
                  />
                ) : null}
                {byProbe
                  ? shownProbes.map((s) => {
                      const slot = probeSlot.get(s) ?? 0;
                      return (
                        <Line
                          key={s}
                          dataKey={`p${slot}`}
                          name={s}
                          stroke={PROBE_PALETTE[slot]}
                          strokeWidth={2}
                          dot={markDots ? { r: 3, fill: PROBE_PALETTE[slot], strokeWidth: 0 } : false}
                          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                          isAnimationActive={false}
                        />
                      );
                    })
                  : null}
                {!byProbe ? (
                  <Line
                    dataKey="mean"
                    stroke={C.mean}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    dot={markDots ? { r: 3.5, fill: C.mean, strokeWidth: 0 } : false}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }}
                    isAnimationActive={false}
                  />
                ) : null}
                {!drag
                  ? extremes.map((e) => (
                      <ReferenceDot
                        key={e.kind}
                        x={e.t}
                        y={e.value}
                        r={4}
                        fill="var(--card)"
                        stroke={e.kind === "max" ? HIGH : C.rain}
                        strokeWidth={2}
                        ifOverflow="discard"
                        label={{ value: `${e.kind === "max" ? "High" : "Low"} ${fmt(e.value)}`, position: e.position, offset: 8, fontSize: 12, fontWeight: 600, fill: e.kind === "max" ? HIGH : C.rain, ...HALO }}
                      />
                    ))
                  : null}
                {drag && drag.a !== drag.b ? <ReferenceArea x1={Math.min(drag.a, drag.b)} x2={Math.max(drag.a, drag.b)} fill={C.mean} fillOpacity={0.1} stroke="none" /> : null}
                <Tooltip
                  cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={(props) => {
                    const p = props as TooltipContentProps<number, string>;
                    const row = p.active ? (p.payload?.[0]?.payload as Row | undefined) : undefined;
                    if (!row) return null;
                    const title = series?.raw || bucketS <= 1 ? pointTime(row.t, multiDay) : `${pointTime(row.t, multiDay)}–${formatTime(iso(row.t + bucketS * 1000))}`;
                    return (
                      <TooltipShell title={title}>
                        {row.mean == null ? (
                          <p className="text-muted-foreground">No readings (device offline)</p>
                        ) : (
                          <>
                            <TooltipRow label={series?.sensors.length === 1 ? "Reading" : "Farm average"} value={fmt(row.mean)} color={byProbe ? undefined : C.mean} />
                            {row.band && row.band[0] !== row.band[1] ? (
                              <TooltipRow label="Range" value={`${fmtNum(row.band[0], def.decimals)}–${fmt(row.band[1])}`} color={byProbe ? undefined : C.range} kind="band" muted />
                            ) : null}
                            {byProbe
                              ? shownProbes.map((s) => {
                                  const slot = probeSlot.get(s) ?? 0;
                                  const v = row[`p${slot}`];
                                  return v == null ? null : <TooltipRow key={s} label={s} value={fmt(v)} color={PROBE_PALETTE[slot]} />;
                                })
                              : null}
                            <TooltipRow label="Readings" value={String(row.n)} muted />
                          </>
                        )}
                      </TooltipShell>
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {series && data ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {byProbe ? (
            <Legend items={shownProbes.map((s) => ({ kind: "line" as const, color: PROBE_PALETTE[probeSlot.get(s) ?? 0], label: s }))}>
              {foldedProbes > 0 ? <span>+{foldedProbes} more in the table</span> : null}
            </Legend>
          ) : (
            <Legend
              items={[
                { kind: "line", color: C.mean, label: series.sensors.length === 1 ? "Reading" : "Farm average" },
                ...(series.sensors.length > 1 || !series.raw ? [{ kind: "band" as const, color: C.range, label: series.sensors.length > 1 ? "Lowest–highest probe" : "Lowest–highest" }] : []),
                ...(summary?.mean != null && rows.length > 2 ? [{ kind: "dash" as const, color: C.axis, label: "Window average" }] : []),
                ...(band ? [{ kind: "band" as const, color: C.adequate, label: bandSide ? `${band.legend}, ${bandSide} this chart` : band.legend }] : []),
              ]}
            />
          )}
          {series.sensors.length > 1 ? (
            <label className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={byProbe} onChange={(e) => setByProbe(e.target.checked)} />
              One line per probe
            </label>
          ) : null}
          <p className="w-full text-xs text-muted-foreground">Drag across the chart to zoom in; gaps are times the devices sent nothing.</p>
        </div>
      ) : null}

      {series && data ? (
        <details className="mt-3 rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Show as a table</summary>
          <div className="scrollbar-thin mt-2 max-h-72 overflow-auto">
            <table className="w-full text-left tabular">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Average</th>
                  <th className="py-1 pr-3 font-medium">Lowest</th>
                  <th className="py-1 pr-3 font-medium">Highest</th>
                  <th className="py-1 font-medium">Readings</th>
                </tr>
              </thead>
              <tbody>
                {[...data.points]
                  .reverse()
                  .filter((p) => p[4] > 0)
                  .map((p) => (
                    <tr key={p[0]} className="border-t">
                      <td className="py-1 pr-3">{pointTime(p[0], true)}</td>
                      <td className="py-1 pr-3">{fmt(p[1])}</td>
                      <td className="py-1 pr-3">{fmt(p[2])}</td>
                      <td className="py-1 pr-3">{fmt(p[3])}</td>
                      <td className="py-1">{p[4]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
