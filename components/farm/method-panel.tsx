"use client";

/**
 * Farm details → Method ("How we calculated this", ui_improvement §7.2): the agronomy inputs,
 * each calculation with today's numbers, the risk score and the sources. Closed by default.
 */
import { FarmProfile } from "@/components/dashboard/farm-profile";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { GROWTH_STAGE_LABEL } from "@/lib/agronomy";
import { CROPS } from "@/lib/agronomy-tables";
import { HEAT_STRESS_SOURCE, NUTRIENT_GUIDE_SOURCE } from "@/lib/crop-guides";
import { fmtNum } from "@/lib/format";
import type { FarmBundle, FarmDay } from "@/lib/types";

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
      </p>
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="max-w-prose space-y-2 text-sm leading-relaxed text-pretty text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">{children}</div>;
}

export function MethodPanel({ bundle, day }: { bundle: FarmBundle; day: FarmDay | null }) {
  const { farm } = bundle;
  const crop = CROPS[farm.main_crop];
  const t = crop.salinity.threshold_dS_per_m;
  const d = day;

  return (
    <section aria-labelledby="method-title" className="rounded-2xl border bg-card px-4 py-2 shadow-xs sm:px-6">
      <h2 id="method-title" className="sr-only">
        How we calculated this
      </h2>
      <Accordion type="multiple">
        <AccordionItem value="water">
          <AccordionTrigger>Crop water use: ET₀ and ETc</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label="Reference ET₀" value={fmtNum(d?.et0, 1)} unit="mm/day" />
              <Figure label="Crop coefficient Kc" value={fmtNum(d?.kc, 2)} unit={d ? GROWTH_STAGE_LABEL[d.stage].toLowerCase() : undefined} />
              <Figure label="Crop water use ETc" value={fmtNum(d?.etc, 1)} unit="mm/day" />
            </div>
            <Prose>
              <p>
                <strong>ET₀</strong>{" "}
                {d?.et0Method === "hargreaves"
                  ? "is estimated with FAO-56 Hargreaves (Eq. 52) because a Penman–Monteith input was missing."
                  : `uses FAO-56 Penman–Monteith (Eq. 6), daily: air temperature and humidity from ${d?.airSource === "probe" ? "the probe mast" : "Open-Meteo"}, wind (10 m → 2 m, Eq. 47) and solar radiation from Open-Meteo.`}{" "}
                Open-Meteo&apos;s own FAO ET₀ ({fmtNum(d?.et0OpenMeteo, 1)} mm/day) is a cross-check.
              </p>
              <p>
                <strong>ETc = Kc × ET₀</strong> (FAO-56 Eq. 56). {crop.name} Kc {crop.kc.ini} / {crop.kc.mid} / {crop.kc.end} by growth stage ({crop.kcSource}), with
                the mid and end values adjusted for local wind and humidity (Eq. 62, 65). Day {d?.dap ?? "—"} after planting.
              </p>
            </Prose>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="salinity">
          <AccordionTrigger>Salinity and yield loss</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label="Bulk soil EC (probe)" value={fmtNum(d?.ec, 2)} unit="dS/m" />
              <Figure label="Estimated ECe" value={fmtNum(d?.ece, 1)} unit="dS/m" />
              <Figure label="Predicted yield at risk" value={fmtNum(d?.yieldLoss, 0)} unit="%" />
            </div>
            <Prose>
              <p>
                <strong>ECe</strong> (saturated-paste salinity) = probe bulk EC × this farm&apos;s calibration factor {fmtNum(farm.ec_calibration_factor, 2)}, fitted from
                paired lab samples. Classes follow FAO/USDA: under 2 non-saline, 2–4 slightly, 4–8 moderately, 8–16 strongly, over 16 dS/m very strongly saline.
              </p>
              <p>
                <strong>Yield at risk</strong> uses the Maas–Hoffman model: loss = b × (ECe − threshold) above the threshold. {crop.name}: threshold {fmtNum(t, 1)} dS/m,
                slope b = {fmtNum(crop.salinity.slope_pct_per_dS_per_m, 1)} % per dS/m ({crop.salinity.source}).
              </p>
            </Prose>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="irrigation">
          <AccordionTrigger>Irrigation timing and depth</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label="Water used (Dr / RAW)" value={fmtNum(d?.deficitPct, 0)} unit="%" />
              <Figure label="Net depth" value={fmtNum(d?.netDepth, 0)} unit="mm" />
              <Figure label="Gross depth (with leaching)" value={fmtNum(d?.grossDepth, 0)} unit="mm" />
            </div>
            <Prose>
              <p>
                <strong>Water used</strong> is root-zone depletion Dr = 1000 (θFC − θ) Zr as a share of readily available water RAW = p × TAW (FAO-56 Eq. 82–87). Zr{" "}
                {fmtNum(d?.rootDepth, 2)} m, TAW {fmtNum(d?.taw, 0)} mm, RAW {fmtNum(d?.raw, 0)} mm. At 100% the crop starts to stress, so that is the moment to
                irrigate.
              </p>
              <p>
                <strong>Days to irrigate</strong> = (RAW − Dr) / ETc. <strong>Net depth</strong> = Dr (refill to field capacity). <strong>Gross depth</strong> = net /
                (1 − LR), with the leaching requirement LR = ECw / (5 ECe − ECw) = {fmtNum((d?.lr ?? 0) * 100, 0)}% (FAO-29 Eq. 7–8), irrigation water ECw{" "}
                {fmtNum(farm.irrigation_water_ec, 1)} dS/m and a target ECe of {fmtNum(d?.eceTarget, 1)} dS/m (90% yield). The countdown assumes no rain.
              </p>
            </Prose>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="risk">
          <AccordionTrigger>The risk score</AccordionTrigger>
          <AccordionContent>
            <Prose>
              <p>
                A 0–100 score that blends the two risks that cost yield here: <strong>salinity</strong> (predicted yield loss and the 30-day ECe trend) and{" "}
                <strong>water stress</strong> (how far the root zone is past its readily available water). The larger of the two leads; small extras are added for
                high pH and falling potassium. 70 and above is high, 40–69 medium, under 40 low.
              </p>
              <p>It is a product heuristic to rank farms, not a published agronomic index. Every number behind it comes from the FAO-56 and FAO-29 methods above.</p>
            </Prose>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="inputs">
          <AccordionTrigger>Agronomy inputs</AccordionTrigger>
          <AccordionContent>
            <FarmProfile bundle={bundle} day={d} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="sources">
          <AccordionTrigger>Data sources</AccordionTrigger>
          <AccordionContent>
            <Prose>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Soil probes</strong> ({bundle.sensors.length} on this farm): bulk EC, moisture, pH, soil temperature and N, P, K, averaged per day.
                </li>
                <li>
                  <strong>Weather</strong>: Open-Meteo daily temperature, humidity, wind, radiation, rain and the 7-day forecast. The forecast never feeds the water
                  balance.
                </li>
                <li>
                  <strong>Methods</strong>: FAO Irrigation and Drainage Paper 56 (evapotranspiration, water balance) and Paper 29 (salinity, leaching).
                </li>
                <li>
                  <strong>Indicative ranges</strong>: {NUTRIENT_GUIDE_SOURCE} {HEAT_STRESS_SOURCE}
                </li>
              </ul>
            </Prose>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
