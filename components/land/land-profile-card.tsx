"use client";

import { BookOpen, ChevronDown, Droplets, Leaf, Sprout, Thermometer, Waves } from "lucide-react";
import { useState } from "react";
import { InfoTip } from "@/components/dashboard/info-tip";
import type { LandCell } from "@/lib/land/profile";
import { cn } from "@/lib/utils";

const fmt = (v: number, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const SUITABILITY_STYLE = {
  "well-suited": "bg-risk-low-soft text-risk-low-ink ring-risk-low/25",
  "with-management": "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/35",
  poor: "bg-muted text-muted-foreground ring-black/5",
} as const;

const SUITABILITY_LABEL = {
  "well-suited": "Well suited",
  "with-management": "With extra leaching",
  poor: "Needs low-salt water",
} as const;

function Stat({ icon, label, value, sub, info }: { icon: React.ReactNode; label: string; value: string; sub: string; info?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        {icon}
        {label}
        {info ? <InfoTip label={`About ${label}`}>{info}</InfoTip> : null}
      </div>
      <p className="mt-0.5 text-[17px] leading-tight font-semibold tabular">{value}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{sub}</p>
    </div>
  );
}

function FertilityBar({ index }: { index: number }) {
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, Math.min(100, index))}%` }} />
    </div>
  );
}

/** Monthly rain bars with July/January temperatures — the cell's long-term climate at a glance. */
function ClimateStrip({ cell }: { cell: LandCell }) {
  const max = Math.max(...cell.climate.monthly.map((m) => m.rain_mm), 1);
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-muted-foreground">Rain (bars) and mean high / low by month</p>
      <div className="grid grid-cols-12 items-end gap-1" role="img" aria-label="Monthly rainfall and temperature">
        {cell.climate.monthly.map((m) => (
          <div key={m.month} className="flex min-w-0 flex-col items-center gap-0.5">
            <div className="flex h-10 w-full items-end justify-center">
              <div
                className="w-full max-w-4 rounded-t bg-sky-500/70"
                style={{ height: `${Math.max(m.rain_mm > 0 ? 6 : 2, (m.rain_mm / max) * 100)}%` }}
                title={`${m.month}: ${fmt(m.rain_mm, 1)} mm`}
              />
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground">{m.month.slice(0, 1)}</span>
            <span className="text-[10px] leading-none text-risk-high-ink tabular">{fmt(m.tmax_C)}</span>
            <span className="text-[10px] leading-none text-sky-700 tabular">{fmt(m.tmin_C)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Land-atlas profile of the 10 km² cell under a farm or a dropped pin. */
export function LandProfileCard({ cell, compact = false, className }: { cell: LandCell; compact?: boolean; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const l = cell.landscape;
  const c = cell.climate;
  const crops = cell.crops.filter((x) => x.suitability !== "poor").slice(0, compact ? 6 : 10);
  const lowSalt = cell.crops.filter((x) => x.suitability === "poor" && x.relativeYieldLowSaltWater >= 90).slice(0, 6);

  return (
    <section aria-label="Land profile" className={cn("@container rounded-2xl border bg-card p-3 shadow-xs sm:p-4", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-[16px] font-semibold">Land profile</h2>
        <span className="text-[12.5px] text-muted-foreground">
          Atlas cell {cell.id} · {cell.municipality} · ≈{fmt(cell.landAreaKm2, 1)} km² of land
        </span>
      </div>
      <p className="mt-1 text-[13.5px] leading-snug">
        <span className="font-medium">{l.landformName}</span>
        {cell.coastDistanceKm < 1 ? ", on the coast" : `, ${fmt(cell.coastDistanceKm, cell.coastDistanceKm < 10 ? 1 : 0)} km from the coast`}
        {l.arable ? ` · rawdat ${l.rawdatDensity}` : " · not farmable"}
      </p>
      {l.protectedArea ? (
        <p className="mt-1 rounded-lg bg-risk-medium-soft px-2.5 py-1.5 text-[12.5px] text-risk-medium-ink">
          May fall within {l.protectedArea} — check with the Ministry of Environment before developing land.
        </p>
      ) : null}

      <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 @2xl:grid-cols-4")}>
        <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <Sprout className="size-3.5" aria-hidden="true" /> Fertility
            <InfoTip label="About fertility">
              Relative to Qatar&apos;s own soils (0–100): deeper, finer rawdat soils score higher; salinity and coastal flats lower it. Based on the soil atlas classes (Scheibert et al. 2005).
            </InfoTip>
          </div>
          <p className="mt-0.5 text-[17px] leading-tight font-semibold">{l.fertilityClass}</p>
          <FertilityBar index={l.fertilityIndex} />
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            {l.fertilityIndex}/100 · {l.soil.texture}
          </p>
        </div>
        <Stat
          icon={<Droplets className="size-3.5" aria-hidden="true" />}
          label="Rainfall"
          value={`≈${fmt(c.annualRain_mm)} mm/yr`}
          sub={`${c.rainyMonths}, wettest ${c.wettestMonth.month} · covers ≈${fmt(c.rainCoverOfEt0_pct)}% of ET₀`}
          info="Long-term mean modelled from 29 rain gauges (Mamoon & Rahman 2017): ≈55 mm in the south to ≈105 mm in the north."
        />
        <Stat
          icon={<Thermometer className="size-3.5" aria-hidden="true" />}
          label="Temperature"
          value={`${fmt(c.summerTmax_C)}° / ${fmt(c.winterTmin_C)}°C`}
          sub={`${c.hottestMonth.month} mean high / ${c.coolestMonth.month} mean low · humidity ${c.meanRh_pct}%`}
          info="Doha climate normals (QMD 1962–2013) adjusted for latitude and distance from the coast."
        />
        <Stat
          icon={<Waves className="size-3.5" aria-hidden="true" />}
          label="Groundwater"
          value={`≈${fmt(l.groundwater.tds_mg_l)} mg/L`}
          sub={`ECw ${fmt(l.groundwater.ecw_dS_m, 1)} dS/m · ${l.groundwater.basin} · ${l.groundwater.restriction.replace("-", " to ")} restriction`}
          info="Estimated from published aquifer salinity ranges; FAO-29 Table 1 restriction classes. Test your well — it overrides this."
        />
      </div>

      {!compact ? (
        <div className="mt-3">
          <ClimateStrip cell={cell} />
        </div>
      ) : null}

      {l.arable ? (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
            <Leaf className="size-3.5" aria-hidden="true" /> What it can grow with the local groundwater (relative yield, Maas–Hoffman)
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {crops.map((crop) => (
              <li
                key={crop.id}
                className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium ring-1 ring-inset", SUITABILITY_STYLE[crop.suitability])}
                title={`${SUITABILITY_LABEL[crop.suitability]} · ${crop.season}`}
              >
                {crop.name}
                <span className="tabular opacity-75">{crop.relativeYield}%</span>
              </li>
            ))}
          </ul>
          {lowSalt.length ? (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              With desalinated or blended water (ECw ≈0.8 dS/m) also: {lowSalt.map((x) => x.name).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 border-t pt-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
          aria-expanded={expanded}
        >
          <BookOpen className="size-3.5" aria-hidden="true" /> {expanded ? "Hide" : "Read"} the full description and sources
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
        </button>
        {expanded ? (
          <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-foreground/90">
            {cell.description.split("\n\n").map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
            <p className="text-[12px] text-muted-foreground">Method: {c.method}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
              {cell.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
