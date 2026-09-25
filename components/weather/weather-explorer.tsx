"use client";

/**
 * The Weather page. It shows the Gulf forecast map with a chip per layer. Below it:
 * - the meteogram for the farm or dropped pin you pick, with the next three days' highlights
 * - every farm's weather at the map's hour, in one table
 */
import { ArrowUp, Layers, Maximize2, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { InfoTip } from "@/components/dashboard/info-tip";
import { Legend } from "@/components/charts/chart-kit";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compassPoint, fmtNum, formatDay, formatTime, plural, qatarDay } from "@/lib/format";
import { pointSeriesMany, type PointHour } from "@/lib/weather/field";
import { WEATHER_LAYER_GROUPS, WEATHER_LAYERS, type WeatherLayerKey } from "@/lib/weather/layers";
import { paletteColor, PALETTES, textOn } from "@/lib/weather/palettes";
import { goodWindows, sprayForHour, SPRAY_TONE_CLASS } from "@/lib/weather/work-windows";
import { cn } from "@/lib/utils";
import { WEATHER_LAYER_ICON } from "./layer-icons";
import { Meteogram, METEOGRAM_LEGEND } from "./meteogram";
import { usePlayback } from "./use-playback";
import { useWeatherGrid } from "./use-weather-grid";
import { hourLabel } from "./weather-timeline";
import { DEFAULT_WEATHER_OPTIONS, WeatherOptions, type WeatherOptionsState } from "./weather-options";
import { WeatherStage } from "./weather-stage";

export interface WeatherFarm {
  id: string;
  name: string;
  region: string;
  crop: string;
  lat: number;
  lng: number;
}

const DOHA = { lat: 25.29, lng: 51.53, name: "Doha" };
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const hh = (ms: number) => formatTime(iso(ms));
const dayShort = (ms: number) => formatDay(qatarDay(iso(ms))).replace(/ \w+$/, "");
const LAYER_ORDER = WEATHER_LAYER_GROUPS.flatMap((g) => g.keys);

function setQuery(key: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  const q = params.toString();
  window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
}

export function WeatherExplorer({ farms, initialFarmId, initialLayer }: { farms: WeatherFarm[]; initialFarmId: string | null; initialLayer: WeatherLayerKey }) {
  const grid = useWeatherGrid();
  const field = grid.field;
  const playback = usePlayback(field?.nt ?? 1);
  const [layer, setLayerState] = useState<WeatherLayerKey>(initialLayer);
  const [options, setOptions] = useState<WeatherOptionsState>(DEFAULT_WEATHER_OPTIONS);
  const [selectedId, setSelectedId] = useState<string | null>(initialFarmId ?? farms[0]?.id ?? null);
  const [pin, setPinState] = useState<{ lat: number; lng: number } | null>(null);
  const [usePin, setUsePin] = useState(false);
  const [fit, setFit] = useState(0);
  const [focus, setFocus] = useState(0);

  const farm = farms.find((f) => f.id === selectedId) ?? null;
  const spot = usePin && pin ? { lat: pin.lat, lng: pin.lng, name: "Dropped pin" } : farm ? { lat: farm.lat, lng: farm.lng, name: farm.name } : DOHA;

  const setLayer = (key: WeatherLayerKey) => {
    setLayerState(key);
    setQuery("layer", key === "wind" ? null : key);
  };
  const selectFarm = (id: string, zoom = false) => {
    setSelectedId(id);
    setUsePin(false);
    setQuery("farm", id);
    if (zoom) setFocus((n) => n + 1);
  };
  const setPin = (p: { lat: number; lng: number } | null) => {
    setPinState(p);
    setUsePin(p != null);
  };

  // Every farm's hours plus the picked spot's, sampled together.
  const series = useMemo(() => {
    if (!field) return null;
    const all = pointSeriesMany(field, [...farms.map((f) => ({ lat: f.lat, lng: f.lng })), { lat: spot.lat, lng: spot.lng }]);
    return { farms: all.slice(0, farms.length), spot: all[farms.length] };
  }, [field, farms, spot.lat, spot.lng]);

  const def = WEATHER_LAYERS[layer];
  const spotHours = series?.spot ?? null;
  const spotOk = spotHours != null && spotHours.length > 1 && Number.isFinite(spotHours[0].temp);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Weather</h1>
          <p className="mt-1 max-w-3xl text-sm text-pretty text-muted-foreground">
            Hour by hour for the next 3 days across Qatar and the Gulf, on a 0.1° grid over Qatar (about 11 km) and 0.5° over the Gulf.
            {field ? (
              <>
                {" "}
                Updated {formatTime(field.fetchedAt)}, next update {formatDay(qatarDay(field.nextRefreshAt))} {formatTime(field.nextRefreshAt)}.
              </>
            ) : null}
          </p>
        </div>
      </header>

      {/* The map */}
      <section aria-label="Weather map" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex items-center gap-2 border-b px-2.5 py-2">
          <div
            role="radiogroup"
            aria-label="Map layer"
            className="-my-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] [scrollbar-width:none]"
          >
            {LAYER_ORDER.map((key) => {
              const Icon = WEATHER_LAYER_ICON[key];
              const on = key === layer;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setLayer(key)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none pointer-coarse:h-11",
                    on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {WEATHER_LAYERS[key].short === "Temp." ? "Temperature" : WEATHER_LAYERS[key].short}
                </button>
              );
            })}
          </div>
          <InfoTip label={`About the ${def.label.toLowerCase()} layer`} side="bottom">
            <p className="font-semibold">{def.label}</p>
            <p className="mt-1 text-muted-foreground">{def.about}</p>
          </InfoTip>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="size-9 rounded-xl pointer-coarse:size-11" aria-label="Map options">
                <Layers />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <WeatherOptions value={options} onChange={setOptions} hasIsolines={Boolean(def.isolines)} />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" className="hidden size-9 rounded-xl sm:inline-flex pointer-coarse:size-11" aria-label="Show all of Qatar" onClick={() => setFit((n) => n + 1)}>
            <Maximize2 />
          </Button>
        </div>
        <div className="relative isolate h-[clamp(440px,66dvh,800px)]">
          <WeatherStage
            field={field}
            error={grid.error}
            onRetry={grid.retry}
            layer={layer}
            farms={farms}
            selectedId={usePin ? null : selectedId}
            onSelectFarm={(id) => selectFarm(id)}
            options={options}
            t={playback.t}
            onT={playback.setT}
            playing={playback.playing}
            onPlayingChange={playback.setPlaying}
            pin={pin}
            onPin={setPin}
            focus={spot}
            fitSignal={fit}
            focusSignal={focus}
            showPinReadout
          />
        </div>
      </section>

      {/* The spot's next three days */}
      <section aria-labelledby="wx-spot-title" className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="wx-spot-title" className="text-base font-semibold">
              Next 3 days at {spot.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {usePin && pin
                ? `${pin.lat.toFixed(2)}° N, ${pin.lng.toFixed(2)}° E · tap the map to move the pin`
                : farm
                  ? `${farm.crop} · ${farm.region} · hover or use the arrow keys to read an hour; click to show it on the map`
                  : "Tap the map to drop a pin anywhere"}
            </p>
          </div>
          {farms.length > 0 ? (
            <Select
              value={usePin && pin ? "__pin" : (selectedId ?? undefined)}
              onValueChange={(v) => (v === "__pin" ? setUsePin(true) : selectFarm(v, true))}
            >
              <SelectTrigger aria-label="Place" className="h-9 w-full min-w-0 sm:w-64 pointer-coarse:h-11">
                <SelectValue placeholder="Pick a farm" />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectGroup>
                  <SelectLabel>Farms</SelectLabel>
                  {farms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {pin ? (
                  <SelectGroup>
                    <SelectLabel>Map</SelectLabel>
                    <SelectItem value="__pin">
                      <MapPin /> Dropped pin
                    </SelectItem>
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {spotOk && spotHours ? (
          <>
            <Highlights hours={spotHours} />
            <Legend items={METEOGRAM_LEGEND} className="mt-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="flex h-2.5 overflow-hidden rounded-sm" aria-hidden="true">
                  <span className="w-1.5 bg-risk-low" />
                  <span className="w-1.5 bg-risk-medium/60" />
                  <span className="w-1.5 bg-risk-high/60" />
                </span>
                Spraying good · marginal · poor
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-sm bg-[oklch(0.32_0.04_265/0.14)]" aria-hidden="true" />
                Night
              </span>
            </Legend>
            <Meteogram hours={spotHours} t={playback.t} onT={(i) => playback.setT(i)} lat={spot.lat} lng={spot.lng} place={spot.name} className="mt-3" />
          </>
        ) : (
          <div className="mt-4 h-48 animate-pulse rounded-xl bg-muted/60" aria-hidden="true" />
        )}
      </section>

      {/* Every farm */}
      {farms.length > 0 ? (
        <FarmTable
          farms={farms}
          hours={series?.farms ?? null}
          t={playback.t}
          times={field?.times ?? []}
          selectedId={usePin ? null : selectedId}
          onSelect={(id) => selectFarm(id, true)}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        Forecast from{" "}
        <a href="https://open-meteo.com/" className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        (best-match weather models; CC BY 4.0), refreshed at 00:00 and 12:00 Qatar time. Spraying ratings follow extension guidance on wind and Delta-T and are
        indicative only.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlights: the next three days in six numbers
// ---------------------------------------------------------------------------

function Tile({ label, value, sub, swatch }: { label: string; value: React.ReactNode; sub?: React.ReactNode; swatch?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
        {swatch ? <span className="size-2.5 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden="true" /> : null}
        {label}
      </p>
      <p className="mt-0.5 truncate text-xl font-semibold tracking-tight tabular">{value}</p>
      {sub ? <p className="truncate text-xs text-muted-foreground tabular">{sub}</p> : null}
    </div>
  );
}

const rgb = (c: number[]) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

function Highlights({ hours }: { hours: PointHour[] }) {
  const argmax = (get: (h: PointHour) => number) => hours.reduce((b, h, i) => (get(h) > get(hours[b]) ? i : b), 0);
  const hot = hours[argmax((h) => h.temp)];
  const cool = hours[argmax((h) => -h.temp)];
  const feels = hours[argmax((h) => h.feels)];
  const gust = hours[argmax((h) => h.gust)];
  const rain = hours.reduce((s, h) => s + h.precip, 0);
  const chance = Math.max(...hours.map((h) => h.precipProb || 0));
  const humid = hours.filter((h) => h.rh >= 90 || h.temp - h.dew <= 2).length;
  const windows = goodWindows(hours, 2);
  const best = windows[0];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Tile label="Hottest" value={`${fmtNum(hot.temp, 0)} °C`} sub={`${dayShort(hot.time)} ${hh(hot.time)}`} swatch={rgb(paletteColor(PALETTES.temp, hot.temp))} />
      <Tile label="Coolest" value={`${fmtNum(cool.temp, 0)} °C`} sub={`${dayShort(cool.time)} ${hh(cool.time)}`} swatch={rgb(paletteColor(PALETTES.temp, cool.temp))} />
      <Tile label="Feels like, peak" value={`${fmtNum(feels.feels, 0)} °C`} sub={feels.feels >= 40 ? "Heat stress: rest breaks" : `${dayShort(feels.time)} ${hh(feels.time)}`} />
      <Tile label="Strongest gust" value={`${fmtNum(gust.gust, 0)} m/s`} sub={`${fmtNum(gust.gust * 3.6, 0)} km/h · ${dayShort(gust.time)} ${hh(gust.time)}`} swatch={rgb(paletteColor(PALETTES.wind, gust.gust))} />
      <Tile label="Rain, 3 days" value={rain >= 0.1 ? `${fmtNum(rain, 1)} mm` : "Dry"} sub={`Peak chance ${fmtNum(chance, 0)}%`} />
      <Tile
        label="Best time to spray"
        value={best ? `${dayShort(hours[best.from].time)} ${hh(hours[best.from].time)}` : "No window"}
        sub={best ? `${best.to - best.from + 1} h window, to ${hh(hours[best.to].time + HOUR)}` : humid ? `${plural(humid, "damp hour")}` : "Too windy or too hot"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Every farm at the map's hour
// ---------------------------------------------------------------------------

function ValueChip({ value, palette, text }: { value: number; palette: keyof typeof PALETTES; text: string }) {
  const c = paletteColor(PALETTES[palette], value);
  return (
    <span className="inline-flex h-6 min-w-12 items-center justify-center rounded-md px-1.5 text-sm font-semibold tabular" style={{ background: rgb(c), color: textOn(c) }}>
      {text}
    </span>
  );
}

function FarmTable({
  farms,
  hours,
  t,
  times,
  selectedId,
  onSelect,
}: {
  farms: WeatherFarm[];
  hours: PointHour[][] | null;
  t: number;
  times: number[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const i = Math.max(0, Math.min(times.length - 1, Math.round(t)));
  const at = times[i];
  return (
    <section aria-labelledby="wx-farms-title" className="rounded-2xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-5">
        <h2 id="wx-farms-title" className="text-base font-semibold">
          Your farms
        </h2>
        <p className="text-sm text-muted-foreground">{at ? `At ${hourLabel(at)} (the map's hour) · 3-day totals` : "Loading the forecast…"}</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 pl-4 font-medium sm:pl-5">
                Farm
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Temperature
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Wind
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Humidity
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                High / low, 3 days
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Rain, 3 days
              </th>
              <th scope="col" className="py-2 pr-4 pl-3 font-medium sm:pr-5">
                Spraying
              </th>
            </tr>
          </thead>
          <tbody>
            {farms.map((f, k) => {
              const hs = hours?.[k];
              const h = hs?.[i];
              const ok = h != null && Number.isFinite(h.temp);
              const selected = f.id === selectedId;
              const spray = ok ? sprayForHour(h) : null;
              const ahead = hs ? hs.slice(i) : [];
              const next = ahead.length ? goodWindows(ahead, 2).sort((a, b) => a.from - b.from)[0] : undefined;
              const hi = hs ? Math.max(...hs.map((x) => x.temp)) : NaN;
              const lo = hs ? Math.min(...hs.map((x) => x.temp)) : NaN;
              const rain = hs ? hs.reduce((s, x) => s + x.precip, 0) : NaN;
              const chance = hs ? Math.max(...hs.map((x) => x.precipProb || 0)) : NaN;
              return (
                <tr
                  key={f.id}
                  onClick={() => onSelect(f.id)}
                  aria-selected={selected}
                  className={cn("cursor-pointer border-b last:border-b-0 hover:bg-muted/40", selected && "bg-primary/[0.06] hover:bg-primary/[0.09]")}
                >
                  <th scope="row" className="py-2.5 pr-3 pl-4 text-left font-normal sm:pl-5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(f.id);
                      }}
                      className="rounded-sm text-left font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                    >
                      {f.name}
                    </button>
                    <span className="block text-xs text-muted-foreground">
                      {f.crop} · {f.region}
                    </span>
                  </th>
                  {ok && h ? (
                    <>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <ValueChip value={h.temp} palette="temp" text={`${fmtNum(h.temp, 0)}°`} />
                          <span className="text-xs text-muted-foreground tabular">feels {fmtNum(h.feels, 0)}°</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <ValueChip value={h.wind} palette="wind" text={fmtNum(h.wind, 1)} />
                          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular">
                            <ArrowUp className="size-3.5" style={{ transform: `rotate(${h.windDir + 180}deg)` }} aria-hidden="true" />
                            {compassPoint(h.windDir)} · gusts {fmtNum(h.gust, 0)}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <ValueChip value={h.rh} palette="rh" text={`${fmtNum(h.rh, 0)}%`} />
                          <span className="text-xs text-muted-foreground tabular">dew {fmtNum(h.dew, 0)}°</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular">
                        <span className="font-semibold">{fmtNum(hi, 0)}°</span>
                        <span className="text-muted-foreground"> / {fmtNum(lo, 0)}°</span>
                      </td>
                      <td className="px-3 py-2.5 tabular">
                        {rain >= 0.1 ? <span className="font-semibold">{fmtNum(rain, 1)} mm</span> : <span className="text-muted-foreground">Dry</span>}
                        <span className="block text-xs text-muted-foreground">peak chance {fmtNum(chance, 0)}%</span>
                      </td>
                      <td className="py-2.5 pr-4 pl-3 sm:pr-5">
                        {spray ? (
                          <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold", SPRAY_TONE_CLASS[spray.tone])} title={spray.reason}>
                            {spray.label}
                          </span>
                        ) : null}
                        <span className="block text-xs text-muted-foreground tabular">
                          {next ? `Next window ${dayShort(ahead[next.from].time)} ${hh(ahead[next.from].time)}–${hh(ahead[next.to].time + HOUR)}` : "No window in 3 days"}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-3 py-2.5 text-muted-foreground">
                      {hours ? "Outside the forecast area" : "Loading…"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
