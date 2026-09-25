"use client";

import { ChartLine, Download, LayoutGrid, Loader2, RefreshCw, Table2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { InfoTip } from "@/components/dashboard/info-tip";
import { Segmented } from "@/components/dashboard/segmented";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CROPS } from "@/lib/agronomy-tables";
import { moistureLimitsPct } from "@/lib/dashboard";
import { SERIES_RANGE_KEYS, SERIES_RANGES, type SeriesField, type SeriesRangeKey, type SeriesResponse } from "@/lib/data/series";
import { formatShortDay, formatTime, qatarDay } from "@/lib/format";
import type { FarmBundle } from "@/lib/types";
import { useJson } from "@/hooks/use-json";
import { cn } from "@/lib/utils";

/** Categorical slots in fixed order (validated palette) — a probe keeps its colour whatever is shown. */
const PROBE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const MEAN_COLOR = "oklch(0.24 0.026 155)";
const BAND_COLOR = "oklch(0.6 0.1 158)";
const GRID_STROKE = "oklch(0.3 0.02 120 / 0.1)";
const AXIS_TICK = { fontSize: 11, fill: "oklch(0.47 0.025 115)" };

type ExplorerMetric = "moisture" | "temperature" | "ece" | "ec" | "ph" | "n" | "p" | "k" | "air_temp" | "air_humidity";

interface MetricSpec {
  label: string;
  unit: string;
  field: SeriesField;
  decimals: number;
  /** ECe is estimated from bulk EC with the farm's calibration factor. */
  scaled?: boolean;
  info: string;
}

const METRIC_SPECS: Record<ExplorerMetric, MetricSpec> = {
  moisture: { label: "Soil moisture", unit: "% VWC", field: "moisture", decimals: 1, info: "Volumetric water content from each probe." },
  temperature: { label: "Soil temperature", unit: "°C", field: "temperature", decimals: 1, info: "Probe thermistor at root depth." },
  ece: {
    label: "Salinity (ECe, est.)",
    unit: "dS/m",
    field: "ec",
    decimals: 2,
    scaled: true,
    info: "Estimated saturated-paste ECe = probe bulk EC × the farm's calibration factor.",
  },
  ec: { label: "Bulk EC (as measured)", unit: "dS/m", field: "ec", decimals: 3, info: "The probe's raw bulk soil EC (µS/cm ÷ 1000)." },
  ph: { label: "Soil pH", unit: "pH", field: "ph", decimals: 2, info: "Probe pH electrode." },
  n: { label: "Nitrogen (N)", unit: "mg/kg", field: "n", decimals: 0, info: "Probe N estimate." },
  p: { label: "Phosphorus (P)", unit: "mg/kg", field: "p", decimals: 0, info: "Probe P estimate." },
  k: { label: "Potassium (K)", unit: "mg/kg", field: "k", decimals: 0, info: "Probe K estimate." },
  air_temp: { label: "Air temperature", unit: "°C", field: "air_temp", decimals: 1, info: "Optional air sensor on the probe mast." },
  air_humidity: { label: "Air humidity", unit: "%", field: "air_humidity", decimals: 0, info: "Optional air sensor on the probe mast." },
};
const METRIC_ORDER = Object.keys(METRIC_SPECS) as ExplorerMetric[];

type View = "chart" | "all" | "table";

const fmt = (v: number | null | undefined, d: number) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function timeLabel(ms: number, range: SeriesRangeKey): string {
  const iso = new Date(ms).toISOString();
  return range === "1h" || range === "6h" || range === "24h" ? formatTime(iso) : `${formatShortDay(qatarDay(iso))} ${formatTime(iso)}`;
}

function fullTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${formatShortDay(qatarDay(iso))}, ${formatTime(iso)}`;
}

interface Row {
  t: number;
  label: string;
  mean: number | null;
  band: [number, number] | null;
  [probe: string]: number | string | null | [number, number];
}

/** Values of one metric per probe, scaled for ECe. */
function metricValues(series: SeriesResponse, metric: ExplorerMetric, factor: number): Array<Array<number | null>> {
  const spec = METRIC_SPECS[metric];
  return series.values[spec.field].map((probe) => probe.map((v) => (v == null ? null : spec.scaled ? v * factor : v)));
}

function buildRows(series: SeriesResponse, values: Array<Array<number | null>>): Row[] {
  return series.t.map((t, ti) => {
    const row: Row = { t, label: timeLabel(t, series.range), mean: null, band: null };
    let sum = 0;
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    series.sensors.forEach((id, si) => {
      const v = values[si][ti];
      row[id] = v;
      if (v != null) {
        sum += v;
        n++;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    });
    row.mean = n ? sum / n : null;
    row.band = n >= 2 ? [lo, hi] : null;
    return row;
  });
}

interface Stats {
  latest: number | null;
  latestAt: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  readings: number;
}

function statsFor(times: number[], values: Array<number | null>, counts: number[]): Stats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  let latest: number | null = null;
  let latestAt: number | null = null;
  let readings = 0;
  values.forEach((v, i) => {
    readings += counts[i] ?? 0;
    if (v == null) return;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    n++;
    latest = v;
    latestAt = times[i];
  });
  return { latest, latestAt, min: n ? min : null, max: n ? max : null, mean: n ? sum / n : null, readings };
}

function toCsv(series: SeriesResponse, factor: number): string {
  const header = ["time_utc", "probe", "readings", "moisture_pct", "soil_temp_c", "ec_dS_m", "ece_est_dS_m", "ph", "n_mg_kg", "p_mg_kg", "k_mg_kg", "air_temp_c", "air_humidity_pct"];
  const lines = [header.join(",")];
  series.t.forEach((t, ti) => {
    series.sensors.forEach((id, si) => {
      if (!series.counts[si][ti]) return;
      const v = (f: SeriesField) => series.values[f][si][ti];
      const ec = v("ec");
      const cells = [
        new Date(t).toISOString(),
        id,
        series.counts[si][ti],
        v("moisture"),
        v("temperature"),
        ec,
        ec == null ? null : Math.round(ec * factor * 1000) / 1000,
        v("ph"),
        v("n"),
        v("p"),
        v("k"),
        v("air_temp"),
        v("air_humidity"),
      ];
      lines.push(cells.map((c) => (c == null ? "" : String(c))).join(","));
    });
  });
  return lines.join("\n");
}

function ExplorerTooltip({
  active,
  payload,
  spec,
  probes,
  hidden,
}: TooltipContentProps<number, string> & { spec: MetricSpec; probes: string[]; hidden: Set<string> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  const unit = spec.unit === "pH" ? "" : ` ${spec.unit}`;
  return (
    <div className="min-w-48 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 font-semibold">{fullTime(row.t)}</p>
      <p className="flex items-center gap-2 tabular">
        <span className="h-0.5 w-3 rounded-full" style={{ background: MEAN_COLOR }} />
        Farm mean <span className="ml-auto pl-3 font-semibold">{fmt(row.mean, spec.decimals)}{unit}</span>
      </p>
      {probes.map((id, i) =>
        hidden.has(id) || row[id] == null ? null : (
          <p key={id} className="flex items-center gap-2 text-muted-foreground tabular">
            <span className="h-0.5 w-3 rounded-full" style={{ background: PROBE_COLORS[i % PROBE_COLORS.length] }} />
            {id}
            <span className="ml-auto pl-3 text-foreground">{fmt(row[id] as number, spec.decimals)}{unit}</span>
          </p>
        ),
      )}
    </div>
  );
}

function MiniChart({ rows, spec, syncId }: { rows: Row[]; spec: MetricSpec; syncId: string }) {
  const has = rows.some((r) => r.mean != null);
  return (
    <section aria-label={spec.label} className="min-w-0 rounded-xl border p-3">
      <h4 className="mb-1 text-[13px] font-semibold">
        {spec.label} <span className="font-normal text-muted-foreground">· {spec.unit === "pH" ? "pH units" : spec.unit}</span>
      </h4>
      {has ? (
        <div className="h-[140px]" role="img" aria-label={`${spec.label} farm mean and probe range`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId={syncId} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} minTickGap={24} axisLine={{ stroke: "oklch(0.3 0.02 120 / 0.2)" }} />
              <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
              <Area dataKey="band" stroke="none" fill={BAND_COLOR} fillOpacity={0.18} isAnimationActive={false} connectNulls activeDot={false} />
              <Line dataKey="mean" stroke={MEAN_COLOR} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Tooltip
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  if (!active || !row) return null;
                  return (
                    <div className="rounded-lg border bg-card px-2.5 py-1.5 text-[12px] shadow-lg tabular">
                      <p className="font-semibold">{fullTime(row.t)}</p>
                      <p>
                        Mean {fmt(row.mean, spec.decimals)} {spec.unit === "pH" ? "" : spec.unit}
                        {row.band ? ` · ${fmt(row.band[0], spec.decimals)}–${fmt(row.band[1], spec.decimals)}` : ""}
                      </p>
                    </div>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="flex h-[140px] items-center justify-center text-[12.5px] text-muted-foreground">No readings</p>
      )}
    </section>
  );
}

/**
 * Every reading the farm's probes sent, over 1 hour to 60 days: raw readings for the last hour,
 * time-bucketed means beyond (~700 points per probe), per probe and as a farm mean with the
 * min–max band across probes.
 */
export function ReadingsExplorer({
  bundle,
  demo,
  refreshKey,
}: {
  bundle: FarmBundle;
  demo: boolean;
  /** Changes when live readings arrive, to refresh the short ranges. */
  refreshKey?: number;
}) {
  const { farm } = bundle;
  const [range, setRange] = useState<SeriesRangeKey>(demo ? "7d" : "24h");
  const [metric, setMetric] = useState<ExplorerMetric>("moisture");
  const [view, setView] = useState<View>("chart");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);

  // Live readings: the short ranges follow along.
  const followsLive = range === "1h" || range === "6h" || range === "24h";
  const liveVersion = followsLive ? (refreshKey ?? 0) : 0;
  const url = `/api/series?farm=${encodeURIComponent(farm.id)}&range=${range}`;
  const series = useJson<SeriesResponse>(url, `${version}.${liveVersion}`, (prev) => prev.includes(`farm=${encodeURIComponent(farm.id)}&`));
  const data = series.data;
  const loading = series.loading;
  const reload = () => setVersion((v) => v + 1);

  const factor = farm.ec_calibration_factor;
  const spec = METRIC_SPECS[metric];
  const available = useMemo(
    () => (data ? METRIC_ORDER.filter((m) => data.values[METRIC_SPECS[m].field].some((p) => p.some((v) => v != null))) : METRIC_ORDER.slice(0, 8)),
    [data],
  );
  const values = useMemo(() => (data ? metricValues(data, metric, factor) : []), [data, metric, factor]);
  const rows = useMemo(() => (data ? buildRows(data, values) : []), [data, values]);
  const probes = data?.sensors ?? [];
  const perProbe = probes.length <= PROBE_COLORS.length;
  // With one probe the farm mean is that probe: draw it once.
  const showMean = probes.length > 1;
  const hasData = rows.some((r) => r.mean != null);

  const references: Array<{ y: number; label: string }> = [];
  if (metric === "ece") {
    const crop = CROPS[farm.main_crop];
    references.push({ y: crop.salinity.threshold_dS_per_m, label: `${crop.name} threshold ${crop.salinity.threshold_dS_per_m} dS/m` });
  }
  if (metric === "moisture") {
    const { fc, wp } = moistureLimitsPct(farm);
    references.push({ y: Math.round(fc * 10) / 10, label: `Field capacity ${fc.toFixed(1)}%` }, { y: Math.round(wp * 10) / 10, label: `Wilting point ${wp.toFixed(1)}%` });
  }

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([toCsv(data, factor)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${farm.id}-readings-${range}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const resolution =
    data == null ? "" : data.bucket_s === 0 ? "every reading" : data.bucket_s < 3600 ? `${data.bucket_s / 60 >= 1 ? `${data.bucket_s / 60}-minute` : `${data.bucket_s}-second`} means` : `${data.bucket_s / 3600}-hour means`;
  const unit = spec.unit === "pH" ? "" : ` ${spec.unit}`;

  return (
    <div className="space-y-3">
      {/* One control row scopes everything below */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-[17px] font-semibold">Readings</h2>
        <Select value={metric} onValueChange={(v) => setMetric(v as ExplorerMetric)}>
          <SelectTrigger size="sm" className="min-w-48 bg-card text-[13px]" aria-label="Reading to plot">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_ORDER.map((m) => (
              <SelectItem key={m} value={m} disabled={Boolean(data) && !available.includes(m)}>
                {METRIC_SPECS[m].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented<SeriesRangeKey>
          ariaLabel="Time range"
          size="sm"
          value={range}
          onChange={setRange}
          options={SERIES_RANGE_KEYS.map((k) => ({ value: k, label: k, ariaLabel: `Last ${SERIES_RANGES[k].label}` }))}
        />
        <Segmented<View>
          ariaLabel="View"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "chart", label: <span className="hidden sm:inline">Chart</span>, icon: <ChartLine />, ariaLabel: "Chart" },
            { value: "all", label: <span className="hidden sm:inline">All readings</span>, icon: <LayoutGrid />, ariaLabel: "All readings" },
            { value: "table", label: <span className="hidden sm:inline">Table</span>, icon: <Table2 />, ariaLabel: "Table" },
          ]}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading} aria-label="Refresh readings">
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={!data || data.total_readings === 0}>
            <Download /> CSV
          </Button>
        </div>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {data
          ? `${data.total_readings.toLocaleString("en-US")} readings from ${probes.length} probe${probes.length === 1 ? "" : "s"} in the last ${SERIES_RANGES[range].label} · plotted as ${resolution}${followsLive ? " · follows live updates" : ""}.`
          : loading
            ? "Loading readings…"
            : (series.error ?? "")}
      </p>

      {data && !hasData ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-card/60 p-6 text-center">
          <p className="text-[15px] font-semibold">No readings in the last {SERIES_RANGES[range].label}</p>
          <p className="max-w-md text-[13px] text-muted-foreground">
            {demo ? "Pick a longer range." : "Pick a longer range, or check that the farm's ESP32 is connected and reporting."}
          </p>
          {!demo ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/setup">Check devices</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {data && hasData && view === "chart" ? (
        <section
          aria-label={`${spec.label} chart`}
          aria-busy={loading}
          className={cn("rounded-2xl border bg-card p-3 shadow-xs transition-opacity sm:p-4", loading && "opacity-70")}
        >
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <h3 className="text-[15px] font-semibold">
              {spec.label} <span className="font-normal text-muted-foreground">· {spec.unit === "pH" ? "pH units" : spec.unit}</span>
            </h3>
            <InfoTip label={`About ${spec.label}`}>{spec.info}</InfoTip>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]" role="group" aria-label="Show or hide probes">
              {showMean ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <svg width="16" height="4" aria-hidden="true">
                      <line x1="0" y1="2" x2="16" y2="2" stroke={MEAN_COLOR} strokeWidth="2.5" />
                    </svg>
                    Farm mean
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2.5 w-4 rounded-sm opacity-40" style={{ background: BAND_COLOR }} aria-hidden="true" />
                    Probe min–max
                  </span>
                </>
              ) : null}
              {perProbe
                ? probes.map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={!hidden.has(id)}
                      onClick={() =>
                        setHidden((h) => {
                          const next = new Set(h);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium transition-opacity",
                        hidden.has(id) ? "opacity-45" : "bg-card",
                      )}
                    >
                      <span className="h-0.5 w-3 rounded-full" style={{ background: PROBE_COLORS[i] }} aria-hidden="true" />
                      {id}
                    </button>
                  ))
                : null}
              {references.map((r) => (
                <span key={r.label} className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <svg width="16" height="4" aria-hidden="true">
                    <line x1="0" y1="2" x2="16" y2="2" stroke="oklch(0.5 0.17 27)" strokeWidth="1.5" strokeDasharray="5 4" />
                  </svg>
                  {r.label}
                </span>
              ))}
            </div>
          </div>
          <div className="h-[360px]" role="img" aria-label={`${spec.label} per probe, last ${SERIES_RANGES[range].label}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} minTickGap={28} axisLine={{ stroke: "oklch(0.3 0.02 120 / 0.2)" }} />
                <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                <Area dataKey="band" stroke="none" fill={BAND_COLOR} fillOpacity={0.16} isAnimationActive={false} connectNulls activeDot={false} />
                {references.map((r) => (
                  <ReferenceLine key={r.label} y={r.y} stroke="oklch(0.5 0.17 27)" strokeDasharray="5 4" strokeWidth={1.25} ifOverflow="extendDomain" />
                ))}
                {perProbe
                  ? probes.map((id, i) =>
                      hidden.has(id) ? null : (
                        <Line
                          key={id}
                          dataKey={id}
                          stroke={PROBE_COLORS[i]}
                          strokeWidth={showMean ? 1.5 : 2}
                          dot={rows.length <= 40 ? { r: 2.5, strokeWidth: 0, fill: PROBE_COLORS[i] } : false}
                          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ),
                    )
                  : null}
                {showMean || !perProbe ? (
                  <Line dataKey="mean" stroke={MEAN_COLOR} strokeWidth={2.5} dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }} connectNulls isAnimationActive={false} />
                ) : null}
                <Tooltip
                  cursor={{ stroke: "oklch(0.3 0.02 120 / 0.35)", strokeWidth: 1 }}
                  content={(props) => <ExplorerTooltip {...(props as TooltipContentProps<number, string>)} spec={spec} probes={probes} hidden={hidden} />}
                />
                {rows.length > 24 ? <Brush dataKey="label" height={22} travellerWidth={8} stroke="oklch(0.42 0.085 158)" fill="var(--card)" tickFormatter={() => ""} /> : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {rows.length > 24 ? <p className="mt-1 text-[11.5px] text-muted-foreground">Drag the handles under the chart to zoom into part of the range.</p> : null}

          {/* Per-probe statistics */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px] tabular">
              <caption className="sr-only">{spec.label} statistics per probe</caption>
              <thead>
                <tr className="border-b text-left text-[11.5px] text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Probe</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Latest</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Min</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Mean</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Max</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Readings</th>
                  <th className="py-1.5 text-right font-medium">Last reading</th>
                </tr>
              </thead>
              <tbody>
                {probes.map((id, i) => {
                  const s = statsFor(data.t, values[i], data.counts[i]);
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {perProbe ? <span className="size-2 rounded-full" style={{ background: PROBE_COLORS[i] }} aria-hidden="true" /> : null}
                          {id}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-semibold">{fmt(s.latest, spec.decimals)}{unit}</td>
                      <td className="py-1.5 pr-3 text-right">{fmt(s.min, spec.decimals)}</td>
                      <td className="py-1.5 pr-3 text-right">{fmt(s.mean, spec.decimals)}</td>
                      <td className="py-1.5 pr-3 text-right">{fmt(s.max, spec.decimals)}</td>
                      <td className="py-1.5 pr-3 text-right">{s.readings.toLocaleString("en-US")}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{s.latestAt ? fullTime(s.latestAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data && hasData && view === "all" ? (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {available.map((m) => (
            <MiniChart key={m} rows={buildRows(data, metricValues(data, m, factor))} spec={METRIC_SPECS[m]} syncId="yai-readings" />
          ))}
        </div>
      ) : null}

      {data && hasData && view === "table" ? (
        <section aria-label={`${spec.label} table`} className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-[12.5px] tabular">
              <caption className="sr-only">{spec.label} by time and probe, newest first</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-[11.5px] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 text-right font-medium">Farm mean</th>
                  {probes.map((id) => (
                    <th key={id} className="px-3 py-2 text-right font-medium">
                      {id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .reverse()
                  .slice(0, 1000)
                  .map((r) => (
                    <tr key={r.t} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium whitespace-nowrap">{fullTime(r.t)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{fmt(r.mean, spec.decimals)}</td>
                      {probes.map((id) => (
                        <td key={id} className="px-3 py-1.5 text-right">
                          {fmt(r[id] as number | null, spec.decimals)}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {rows.length > 1000 ? <p className="border-t px-3 py-2 text-[12px] text-muted-foreground">Showing the newest 1,000 rows — download the CSV for all of them.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
