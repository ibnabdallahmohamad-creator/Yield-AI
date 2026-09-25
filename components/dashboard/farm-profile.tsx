import { CROPS, SOILS } from "@/lib/agronomy-tables";
import { GROWTH_STAGE_LABEL, soilWaterLimits } from "@/lib/agronomy";
import { formatLongDay, fmtNum } from "@/lib/format";
import type { FarmBundle, FarmDay } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Row {
  label: string;
  value: string;
  source: string;
}

/** Every agronomy input behind the farm's numbers, with its unit and where it comes from. */
export function FarmProfile({ bundle, day, className }: { bundle: FarmBundle; day: FarmDay | null; className?: string }) {
  const { farm, kcAdjusted } = bundle;
  const crop = CROPS[farm.main_crop];
  const soil = SOILS[farm.soil_type];
  const limits = soilWaterLimits(farm.soil_type, { thetaFc: farm.theta_fc, thetaWp: farm.theta_wp });
  const overridden = farm.theta_fc != null || farm.theta_wp != null;

  const rows: Row[] = [
    {
      label: "Crop and stage",
      value: `${crop.name}, planted ${formatLongDay(farm.planting_date)}${day ? ` · ${GROWTH_STAGE_LABEL[day.stage].toLowerCase()}, day ${day.dap}` : ""}`,
      source: crop.stageSource,
    },
    {
      label: "Crop coefficient Kc (ini / mid / end)",
      value: `${fmtNum(kcAdjusted.ini, 2)} / ${fmtNum(kcAdjusted.mid, 2)} / ${fmtNum(kcAdjusted.end, 2)}`,
      source: `${crop.kcSource}; mid and end adjusted for local wind and humidity (FAO-56 Eq. 62, 65)`,
    },
    {
      label: "Soil",
      value: `${soil.name} · θFC ${fmtNum(limits.thetaFc, 3)}, θWP ${fmtNum(limits.thetaWp, 3)} m³/m³`,
      source: overridden ? "Farm-specific values (lab / probe calibration)" : soil.source,
    },
    ...(day
      ? [
          {
            label: "Root depth Zr",
            value: `${fmtNum(day.rootDepth, 2)} m`,
            source: "FAO-56 Table 22 (smaller value, for scheduling)",
          },
          {
            label: "Total / readily available water",
            value: `TAW ${fmtNum(day.taw, 0)} mm · RAW ${fmtNum(day.raw, 0)} mm (p = ${fmtNum(day.pAdj, 2)})`,
            source: "FAO-56 Eq. 82–83; p adjusted for ETc (Table 22 footnote)",
          },
        ]
      : []),
    {
      label: "Salt tolerance",
      value: `Threshold ${fmtNum(crop.salinity.threshold_dS_per_m, 1)} dS/m · slope ${fmtNum(crop.salinity.slope_pct_per_dS_per_m, 1)} % per dS/m`,
      source: crop.salinity.source,
    },
    {
      label: "Irrigation water ECw",
      value: `${fmtNum(farm.irrigation_water_ec, 1)} dS/m`,
      source: "Entered per farm (water test)",
    },
    ...(day
      ? [
          {
            label: "Leaching requirement",
            value: `${fmtNum(day.lr * 100, 0)} % (target ECe ${fmtNum(day.eceTarget, 1)} dS/m)`,
            source: "LR = ECw / (5 ECe − ECw), FAO-29 Eq. 7; target = ECe at 90 % yield",
          },
        ]
      : []),
    {
      label: "Probe calibration",
      value: `ECe ≈ ${fmtNum(farm.ec_calibration_factor, 1)} × bulk soil EC`,
      source: "Fit from paired saturated-paste lab samples",
    },
    {
      label: "Elevation",
      value: `${fmtNum(farm.elevation_m, 0)} m`,
      source: "Sets air pressure and the psychrometric constant (FAO-56 Eq. 7–8)",
    },
  ];

  return (
    <dl className={cn("divide-y", className)}>
      {rows.map((r) => (
        <div key={r.label} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <dt className="text-sm font-semibold text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0">
            <span className="block text-sm font-medium tabular">{r.value}</span>
            <span className="block text-xs text-muted-foreground">{r.source}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
