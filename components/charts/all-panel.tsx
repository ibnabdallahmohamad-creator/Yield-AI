"use client";

/**
 * Soil & weather → All (the full-size card only): every daily series as small multiples on one
 * time axis, so a salt rise can be read against the moisture, heat and water use of the same days.
 * The strips share one hover line; the strip under the pointer shows every value for that day.
 */
import { useMemo, useState } from "react";
import { C, Legend, niceScale, TooltipRow, TooltipShell, type MarginLabel } from "@/components/charts/chart-kit";
import { ChartSummary, PanelFooter } from "@/components/charts/panel";
import { latestIn, SoilChart, type ChartRowX, type PanelProps } from "@/components/charts/soil-panels";
import { CROPS } from "@/lib/agronomy-tables";
import { soilRows, triggerSeries } from "@/lib/charts";
import { NUTRIENT_GUIDE, nutrientStatus } from "@/lib/crop-guides";
import { formatDay, fmtNum, plural } from "@/lib/format";
import { classFor, METRICS } from "@/lib/metrics";
import type { FarmBundle, FarmDay, SensorDay } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tone = "bad" | "warn" | null;

interface StripDef {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  farm: (d: FarmDay) => number | null;
  sensor: ((s: SensorDay) => number | null) | null;
  /** A second series on the same axis (dashed), e.g. the air high over soil temperature. */
  second?: { label: string; short: string; get: (d: FarmDay) => number | null };
  /** Draw the irrigation trigger (moisture). */
  trigger?: boolean;
  limit?: { y: number; label: string };
  band?: { y1: number; y2: number; label: string; color: string };
  scale: { minSpan: number; zero?: boolean; atLeast?: number };
  /** Today's reading in words; `short` is the tooltip's version when `text` is long. */
  status: (d: FarmDay) => { text: string; tone: Tone; short?: string } | null;
}

function stripsFor(bundle: FarmBundle): StripDef[] {
  const crop = CROPS[bundle.farm.main_crop];
  const limit = crop.salinity.threshold_dS_per_m;
  const n = NUTRIENT_GUIDE.n;
  return [
    {
      key: "ece",
      label: "Salinity",
      unit: "dS/m",
      decimals: 1,
      farm: (d) => d.ece,
      sensor: (s) => s.ece,
      limit: { y: limit, label: `${crop.name} limit` },
      scale: { minSpan: limit * 1.5, zero: true, atLeast: limit * 1.5 },
      status: (d) =>
        d.ece == null
          ? null
          : d.ece > limit
            ? { text: `${fmtNum(d.yieldLoss, 0)}% of yield at risk`, tone: "bad", short: `${fmtNum(d.yieldLoss, 0)}% at risk` }
            : d.ece >= 0.85 * limit
              ? { text: "Near the limit", tone: "warn" }
              : { text: "Below the limit", tone: null },
    },
    {
      key: "moisture",
      label: "Soil moisture",
      unit: "%",
      decimals: 1,
      farm: (d) => d.moisture,
      sensor: (s) => s.moisture,
      trigger: true,
      scale: { minSpan: 20, zero: true },
      status: (d) =>
        d.deficitPct == null
          ? null
          : d.deficitPct > 100
            ? { text: "Below the irrigation trigger", tone: "bad", short: "below trigger" }
            : d.deficitPct >= 80
              ? { text: "Irrigate soon", tone: "warn" }
              : { text: "Enough water", tone: null },
    },
    {
      key: "temperature",
      label: "Soil temperature",
      unit: "°C",
      decimals: 1,
      farm: (d) => d.temperature,
      sensor: (s) => s.temperature,
      second: { label: "Air high", short: "Air high", get: (d) => d.airTmax },
      scale: { minSpan: 10 },
      status: (d) => (d.airTmax != null ? { text: `air high ${fmtNum(d.airTmax, 0)} °C`, tone: null } : null),
    },
    {
      key: "etc",
      label: "Crop water use",
      unit: "mm/day",
      decimals: 1,
      farm: (d) => d.etc,
      sensor: null,
      second: { label: "Reference ET₀", short: "ET₀", get: (d) => d.et0 },
      scale: { minSpan: 4, zero: true },
      status: (d) => (d.kc != null ? { text: `Kc ${fmtNum(d.kc, 2)} · ${d.stage.replace("-", " ")}`, tone: null } : null),
    },
    {
      key: "ph",
      label: "Soil pH",
      unit: "",
      decimals: 2,
      farm: (d) => d.ph,
      sensor: (s) => s.ph,
      band: { y1: 6.6, y2: 7.4, label: "Neutral", color: C.adequate },
      scale: { minSpan: 1.5 },
      status: (d) => {
        if (d.ph == null) return null;
        const cls = classFor(METRICS.ph, d.ph)?.label ?? null;
        return cls ? { text: d.ph > 8 ? `${cls}, limits P uptake` : cls, tone: d.ph > 8 ? "warn" : null, short: d.ph > 8 ? "alkaline" : undefined } : null;
      },
    },
    {
      key: "n",
      label: "Nitrogen",
      unit: "mg/kg",
      decimals: 0,
      farm: (d) => d.n,
      sensor: (s) => s.n,
      band: { y1: n.low, y2: n.high, label: "Adequate", color: C.adequate },
      scale: { minSpan: n.chartMax, zero: true, atLeast: n.chartMax },
      status: (d) => {
        const s = nutrientStatus("n", d.n);
        return s === "low" ? { text: "Low", tone: "warn" } : s === "ample" ? { text: "Above range", tone: null } : s ? { text: "Adequate", tone: null } : null;
      },
    },
  ];
}

const withUnit = (v: number | null | undefined, def: Pick<StripDef, "unit" | "decimals">) =>
  v == null ? "—" : `${fmtNum(v, def.decimals)}${def.unit === "%" ? "%" : def.unit ? ` ${def.unit}` : ""}`;

const TONE_TEXT: Record<Exclude<Tone, null>, string> = { bad: "font-medium text-risk-high-ink", warn: "font-medium text-risk-medium-ink" };

function Strip({
  def,
  p,
  height,
  showXAxis,
  tooltip,
  renderTooltip,
  onHover,
}: {
  def: StripDef;
  p: PanelProps;
  height: number;
  showXAxis: boolean;
  tooltip: boolean;
  renderTooltip: (row: ChartRowX) => React.ReactNode;
  onHover: (key: string) => void;
}) {
  const { bundle, dates, start, end } = p;
  const rows = useMemo<ChartRowX[]>(() => {
    const base = soilRows(bundle, dates, start, end, def.farm, def.sensor ?? (() => null));
    const trigger = def.trigger ? triggerSeries(bundle, start, end) : null;
    return base.map((r, i) => {
      const day = bundle.days[start + i];
      return { ...r, overlay: def.second && day ? def.second.get(day) : null, ref: trigger ? trigger[i] : null };
    });
  }, [bundle, dates, start, end, def]);
  const scale = useMemo(
    () => niceScale(rows.flatMap((r) => [r.value, r.range?.[0], r.range?.[1], r.overlay, r.ref, def.limit?.y, def.band?.y1, def.band?.y2]), def.scale),
    [rows, def],
  );
  const latest = latestIn(bundle, start, end)?.day ?? null;
  const value = latest ? def.farm(latest) : null;
  const status = latest ? def.status(latest) : null;
  const lastRef = def.trigger ? ([...rows].reverse().find((r) => r.ref != null)?.ref ?? null) : null;
  const lastSecond = def.second ? ([...rows].reverse().find((r) => r.overlay != null)?.overlay ?? null) : null;
  const margin: MarginLabel[] = [
    ...(def.limit ? [{ y: def.limit.y, text: p.narrow ? "Limit" : def.limit.label, tone: "threshold" as const }] : []),
    ...(lastRef != null ? [{ y: lastRef, text: p.narrow ? "Irrigate" : "Irrigate below", tone: "threshold" as const }] : []),
    ...(def.band ? [{ y: (def.band.y1 + def.band.y2) / 2, text: def.band.label, tone: def.band.color === C.adequate ? ("adequate" as const) : ("muted" as const) }] : []),
    ...(def.second && lastSecond != null ? [{ y: lastSecond, text: def.second.short, tone: "muted" as const }] : []),
  ];

  return (
    <div onPointerEnter={() => onHover(def.key)} onFocus={() => onHover(def.key)}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold">{def.label}</span>
        <span className="tabular">{withUnit(value, def)}</span>
        {status ? <span className={status.tone ? TONE_TEXT[status.tone] : "text-muted-foreground"}>{status.text}</span> : null}
      </p>
      <SoilChart
        rows={rows}
        dates={dates}
        end={end}
        scale={scale}
        unit={def.unit}
        decimals={def.decimals}
        height={height + (showXAxis ? 28 : 0)}
        ariaLabel={`${def.label} for ${bundle.farm.name}, last ${end - start + 1} days`}
        bands={def.band ? [{ y1: def.band.y1, y2: def.band.y2, color: def.band.color }] : []}
        threshold={def.limit ?? null}
        refLine={def.trigger ? { label: "Irrigate below" } : null}
        marginLabels={margin}
        markers={p.markers}
        overlayLabel={def.second?.label ?? null}
        probeIds={[]}
        showProbes={false}
        syncId={`all-${bundle.farm.id}`}
        showXAxis={showXAxis}
        narrow={p.narrow}
        tooltip={tooltip}
        renderTooltip={renderTooltip}
      />
    </div>
  );
}

export function AllPanel(p: PanelProps) {
  const { bundle, dates, start, end } = p;
  const strips = useMemo(() => stripsFor(bundle), [bundle]);
  const [hover, setHover] = useState(strips[0].key);
  const latest = latestIn(bundle, start, end)?.day ?? null;
  const flagged = latest ? strips.filter((s) => s.status(latest)?.tone) : [];
  const height = p.narrow ? 64 : 84;

  const tooltipFor = (row: ChartRowX) => {
    const i = dates.indexOf(row.date);
    const day = i >= 0 ? bundle.days[i] : null;
    return (
      <TooltipShell title={formatDay(row.date)}>
        {!day ? (
          <p className="text-muted-foreground">No readings</p>
        ) : (
          strips.map((s) => {
            const st = s.status(day);
            const tone = st?.tone ?? null;
            const second = s.second?.get(day);
            return (
              <div key={s.key}>
                <TooltipRow
                  label={tone && st ? `${s.label} · ${(st.short ?? st.text).toLowerCase()}` : s.label}
                  value={withUnit(s.farm(day), s)}
                  color={s.key === hover ? C.mean : undefined}
                  muted={s.key !== hover && !tone}
                />
                {s.second && second != null && s.key === hover ? <TooltipRow label={s.second.label} value={withUnit(second, s)} color={C.overlay} kind="dash" muted /> : null}
              </div>
            );
          })
        )}
      </TooltipShell>
    );
  };

  const names = flagged.map((s, i) => (i === 0 ? s.label : s.label.toLowerCase()));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  const sentence =
    flagged.length > 0
      ? `${list} ${flagged.length > 1 ? "need" : "needs"} attention. Point at any day to read every series for it.`
      : "Nothing needs attention right now. Point at any day to read every series for it.";

  return (
    <div>
      <p className="mb-3 text-sm text-pretty text-muted-foreground">{sentence}</p>
      <ChartSummary>
        {strips.map((s) => `${s.label} ${withUnit(latest ? s.farm(latest) : null, s)}`).join(". ")}.
      </ChartSummary>
      <div className="space-y-3">
        {strips.map((s, i) => (
          <Strip
            key={s.key}
            def={s}
            p={p}
            height={height}
            showXAxis={i === strips.length - 1}
            tooltip={hover === s.key}
            renderTooltip={tooltipFor}
            onHover={setHover}
          />
        ))}
      </div>
      <Legend
        className="mt-2"
        items={[
          { kind: "line", color: C.mean, label: "Farm mean" },
          { kind: "band", color: C.range, label: "Probe range" },
          { kind: "dash", color: C.threshold, label: "Crop limit / irrigation trigger" },
          { kind: "dash", color: C.overlay, label: "Air high · reference ET₀" },
          { kind: "band", color: C.adequate, label: "Target range" },
        ]}
      />
      <PanelFooter
        stats={
          <span className={cn("text-muted-foreground", flagged.length > 0 && "font-medium text-foreground")}>
            {plural(flagged.length, "series", "series")} flagged of {strips.length}
          </span>
        }
        source={`${plural(bundle.sensors.length, "probe")} · daily means · FAO-56`}
        askHref={p.askHref(`Walk me through ${bundle.farm.name}'s last ${end - start + 1} days: salinity, moisture, temperature, water use, pH and nitrogen together.`)}
      />
    </div>
  );
}
