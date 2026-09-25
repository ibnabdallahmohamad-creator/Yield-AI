"use client";

/**
 * The land-use planner: pick a farm (or enter coordinates anywhere in Qatar), say how much land,
 * which water and what budget, and get the ranked options. The first view is the rules alone;
 * "Analyse land" adds live research on Qatar's news and markets when Claude is configured.
 * Below 1280 px the form folds into a one-line summary ("Change" opens it), so the answer comes first.
 */
import { Loader2, LocateFixed, Search } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useShellFarm } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { LandReport, LandRequest, LandResponse } from "@/lib/land/contract";
import { TYPICAL_WATER_EC, WATER_SOURCE_LABEL, type Level, type WaterSource } from "@/lib/land/options";
import { replaceUrl } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { LandReportView } from "./land-report";

export interface PlannerFarm {
  id: string;
  name: string;
  crop: string;
  region: string;
  lat: number;
  lng: number;
  area_ha: number;
  water_ec_dS_m: number;
}

const CUSTOM = "custom";
const CARD = "rounded-2xl border bg-card p-5 shadow-xs sm:p-6";
const FIELD = "h-11 bg-background sm:h-9 sm:pointer-coarse:h-11";
/** Relative, so no QAR thresholds are implied: what each level typically pays for. */
const BUDGET_LABEL: Record<Level, string> = {
  low: "Low: drip lines, shade net",
  medium: "Medium: orchard, pens, pivot",
  high: "High: cooled greenhouses or houses",
};

function parseNumber(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function LandPlanner({
  farms,
  initialRequest,
  initialReport,
  researchAvailable,
}: {
  farms: PlannerFarm[];
  initialRequest: LandRequest;
  initialReport: LandReport;
  researchAvailable: boolean;
}) {
  const ids = { farm: useId(), lat: useId(), lng: useId(), area: useId(), source: useId(), ec: useId(), budget: useId(), research: useId(), status: useId(), fields: useId() };
  const [farmId, setFarmId] = useState(initialRequest.farm_id ?? CUSTOM);
  const farm = farms.find((f) => f.id === farmId) ?? null;
  const [lat, setLat] = useState(String(farm?.lat ?? initialRequest.lat ?? ""));
  const [lng, setLng] = useState(String(farm?.lng ?? initialRequest.lng ?? ""));
  const [area, setArea] = useState(String(initialRequest.area_ha));
  const [source, setSource] = useState<WaterSource>(initialRequest.water_source);
  const [ec, setEc] = useState(initialRequest.water_ec_dS_m != null ? String(initialRequest.water_ec_dS_m) : "");
  const [budget, setBudget] = useState<Level>(initialRequest.budget);
  const [research, setResearch] = useState(researchAvailable);
  const [report, setReport] = useState(initialReport);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  /** Phones and tablets: the form is folded into a summary until "Change". */
  const [formOpen, setFormOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useShellFarm(farm?.id ?? null, (id) => chooseFarm(id));

  function chooseFarm(id: string) {
    setFarmId(id);
    const f = farms.find((x) => x.id === id);
    if (f) {
      setLat(String(f.lat));
      setLng(String(f.lng));
      setArea(String(f.area_ha));
      setEc("");
      replaceUrl(`/dashboard/land?farm=${encodeURIComponent(f.id)}`);
    } else {
      replaceUrl("/dashboard/land");
    }
  }

  function editCoordinate(set: (v: string) => void, value: string) {
    set(value);
    if (farmId !== CUSTOM) {
      setFarmId(CUSTOM);
      replaceUrl("/dashboard/land");
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFarmId(CUSTOM);
        setLat(pos.coords.latitude.toFixed(5));
        setLng(pos.coords.longitude.toFixed(5));
        setError(null);
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location. Enter the latitude and longitude instead.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function analyse(event: React.FormEvent) {
    event.preventDefault();
    const areaHa = parseNumber(area);
    const ecValue = parseNumber(ec);
    if (areaHa == null || areaHa <= 0) return setError("Enter the area in hectares.");
    if (ec.trim() && ecValue == null) return setError("Water EC must be a number in dS/m, or leave it empty.");
    const body: LandRequest = { area_ha: areaHa, water_source: source, water_ec_dS_m: ecValue, budget, research };
    if (farm) body.farm_id = farm.id;
    else {
      const la = parseNumber(lat);
      const ln = parseNumber(lng);
      if (la == null || ln == null) return setError("Enter the latitude and longitude, e.g. 25.7470 and 51.3732.");
      body.lat = la;
      body.lng = ln;
    }

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/land-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as (LandResponse & { error?: string }) | null;
      if (!res.ok || !json?.report) throw new Error(json?.error ?? `The analysis failed (${res.status}).`);
      setReport(json.report);
      setFormOpen(false);
      resultsRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "The analysis failed.");
    } finally {
      if (abort.current === controller) setPending(false);
    }
  }

  const ecPlaceholder =
    source === "groundwater" ? (farm ? `Farm well: ${farm.water_ec_dS_m}` : "Basin typical") : `Typical ${TYPICAL_WATER_EC[source]}`;

  return (
    <>
      <header>
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Land use</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What a piece of land in Qatar is best used for, from its exact location, water, climate, the market and the 2030 food-security goals.
        </p>
      </header>

      <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <form onSubmit={analyse} aria-labelledby="site-form-heading" className={cn(CARD, "xl:sticky xl:top-20")} noValidate>
          <div className="flex items-center justify-between gap-3">
            <h2 id="site-form-heading" className="text-base font-semibold">
              The land
            </h2>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFormOpen((v) => !v)}
              aria-expanded={formOpen}
              aria-controls={ids.fields}
              className="-my-2 -mr-2 h-11 text-primary sm:h-9 sm:pointer-coarse:h-11 xl:hidden"
            >
              {formOpen ? "Hide" : "Change"}
            </Button>
          </div>
          {formOpen ? null : (
            <p className="mt-1 text-sm text-muted-foreground xl:hidden">
              <span className="font-medium text-foreground">{farm ? farm.name : "Another location"}</span> · {area || "?"} ha · {WATER_SOURCE_LABEL[source]} ·{" "}
              {budget} budget
            </p>
          )}
          <div id={ids.fields} className={cn(!formOpen && "hidden xl:block")}>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={ids.farm}>Farm</Label>
                <Select value={farmId} onValueChange={chooseFarm}>
                  <SelectTrigger id={ids.farm} className={cn(FIELD, "w-full")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {farms.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="min-h-9">
                        {f.name}
                      </SelectItem>
                    ))}
                    {farms.length ? <SelectSeparator /> : null}
                    <SelectItem value={CUSTOM} className="min-h-9">
                      Another location
                    </SelectItem>
                  </SelectContent>
                </Select>
                {farm ? <p className="text-xs text-muted-foreground">{farm.crop} · {farm.region} · the farm&apos;s sensors are included</p> : null}
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Location (decimal degrees)</legend>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={ids.lat} className="text-xs text-muted-foreground">
                      Latitude
                    </Label>
                    <Input id={ids.lat} inputMode="decimal" value={lat} onChange={(e) => editCoordinate(setLat, e.target.value)} className={cn(FIELD, "tabular")} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.lng} className="text-xs text-muted-foreground">
                      Longitude
                    </Label>
                    <Input id={ids.lng} inputMode="decimal" value={lng} onChange={(e) => editCoordinate(setLng, e.target.value)} className={cn(FIELD, "tabular")} />
                  </div>
                </div>
                <Button type="button" variant="ghost" onClick={useMyLocation} disabled={locating} className="-ml-2 h-11 text-primary sm:h-8 sm:pointer-coarse:h-11">
                  {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                  Use my location
                </Button>
              </fieldset>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor={ids.area}>Area (ha)</Label>
                  <Input id={ids.area} inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} className={cn(FIELD, "tabular")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={ids.ec}>Water EC (dS/m)</Label>
                  <Input id={ids.ec} inputMode="decimal" value={ec} placeholder={ecPlaceholder} onChange={(e) => setEc(e.target.value)} className={cn(FIELD, "tabular")} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={ids.source}>Water source</Label>
                <Select value={source} onValueChange={(v) => setSource(v as WaterSource)}>
                  <SelectTrigger id={ids.source} className={cn(FIELD, "w-full")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {(Object.keys(WATER_SOURCE_LABEL) as WaterSource[]).map((s) => (
                      <SelectItem key={s} value={s} className="min-h-9">
                        {WATER_SOURCE_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={ids.budget}>Budget to set up</Label>
                <Select value={budget} onValueChange={(v) => setBudget(v as Level)}>
                  <SelectTrigger id={ids.budget} className={cn(FIELD, "w-full")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {(Object.keys(BUDGET_LABEL) as Level[]).map((b) => (
                      <SelectItem key={b} value={b} className="min-h-9">
                        {BUDGET_LABEL[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Only offered when the server can search; otherwise the report says it used the built-in notes. */}
              {researchAvailable ? (
                <label htmlFor={ids.research} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium select-none">
                  <Switch id={ids.research} checked={research} onCheckedChange={setResearch} />
                  Search current news and markets
                </label>
              ) : null}
            </div>

            <Button type="submit" disabled={pending} className="mt-5 h-11 w-full sm:h-10" aria-describedby={ids.status}>
              {pending ? <Loader2 className="animate-spin" /> : <Search />}
              {pending ? "Analysing…" : "Analyse land"}
            </Button>
            <p id={ids.status} role="status" className={cn("mt-2 text-xs text-muted-foreground", !pending && !error && "sr-only")}>
              {pending ? (research && researchAvailable ? "Searching Qatar news and markets; this can take up to a minute." : "Scoring the options…") : ""}
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </form>

        <div ref={resultsRef} tabIndex={-1} className="scroll-mt-20 outline-none" aria-busy={pending}>
          <LandReportView report={report} />
        </div>
      </div>
    </>
  );
}
