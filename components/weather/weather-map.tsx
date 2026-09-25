"use client";

/**
 * The weather map (Windy-style): a smooth colour field for the chosen layer, animated wind streaks,
 * isolines with labels, crisp coastlines and borders, place labels above the colours, and every farm
 * with the layer's value at its location. Hovering reads the value under the pointer; clicking drops
 * a pin for the full forecast of that spot.
 *
 * Layer order (z-index): basemap 200 · colour field 350 · lines 420 · wind 430 · place labels 440 ·
 * farm markers 600 (Leaflet's marker pane).
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import { GestureZoom } from "@/components/dashboard/map/gesture-zoom";
import { FieldSampler, frameAt, windFromDeg, type WeatherField } from "@/lib/weather/field";
import { GULF_BORDERS, GULF_COASTLINES } from "@/lib/weather/gulf-lines";
import { formatWeather, WEATHER_LAYERS, type WeatherLayerDef, type WeatherLayerKey } from "@/lib/weather/layers";
import { lutFor, paletteColor, textOn } from "@/lib/weather/palettes";
import { mercatorHeight, renderLevel } from "@/lib/weather/render";
import { QATAR_BOUNDS } from "@/lib/qatar/location";
import { IsolineCanvas } from "./isolines";
import { WindParticles, type StreakMode } from "./particles";

export type WeatherBasemap = "dark" | "light" | "satellite";

export interface WeatherMapFarm {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface WeatherHover {
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface WeatherMapProps {
  field: WeatherField;
  layer: WeatherLayerKey;
  /** Fractional hour index into `field.times`. */
  t: number;
  /** Lower resolution while the timeline plays. */
  fast?: boolean;
  farms: WeatherMapFarm[];
  selectedId?: string | null;
  onSelectFarm?: (id: string) => void;
  pin?: { lat: number; lng: number } | null;
  onPin?: (p: { lat: number; lng: number } | null) => void;
  basemap: WeatherBasemap;
  streaks: StreakMode;
  isolines: boolean;
  /** Opacity of the colour field (0–1). */
  opacity?: number;
  /** Start zoomed on this point instead of all of Qatar. */
  focus?: { lat: number; lng: number; zoom: number } | null;
  scrollWheelZoom?: boolean;
  gestureZoom?: boolean;
  touchDrag?: boolean;
  /** Increment to fly back to all of Qatar. */
  fitSignal?: number;
  /** Increment to fly to the selected farm. */
  focusSignal?: number;
  attributionPosition?: L.ControlPosition;
  zoomControl?: boolean;
}

const PANE = { field: "wx-field", lines: "wx-lines", wind: "wx-wind", labels: "wx-labels" } as const;

// Esri's canvas and imagery tiles need no key (CARTO's basemaps now do).
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const TILES = {
  darkBase: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  darkLabels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  lightBase: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  lightLabels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  imagery: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
  imageryLabels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
};
const CANVAS_CREDIT = "Map © Esri, HERE, Garmin, © OpenStreetMap contributors";
const WEATHER_CREDIT = 'Weather <a href="https://open-meteo.com/">Open-Meteo</a>';

/** Qatar with a little sea around it: the default view. */
export const QATAR_VIEW = L.latLngBounds([QATAR_BOUNDS.south - 0.1, QATAR_BOUNDS.west - 0.15], [QATAR_BOUNDS.north + 0.1, QATAR_BOUNDS.east + 0.15]);

const toLatLngs = (flat: number[]) => {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i + 1], flat[i]]);
  return out;
};
const COASTS = GULF_COASTLINES.map(toLatLngs);
const BORDERS = GULF_BORDERS.map(toLatLngs);

// ---------------------------------------------------------------------------
// Panes and view
// ---------------------------------------------------------------------------

/** Custom panes, created before any layer is added (layout effects run before react-leaflet's). */
function Panes({ opacity }: { opacity: number }) {
  const map = useMap();
  useLayoutEffect(() => {
    const make = (name: string, z: number) => {
      const pane = map.getPane(name) ?? map.createPane(name);
      pane.style.zIndex = String(z);
      pane.style.pointerEvents = "none";
      return pane;
    };
    make(PANE.field, 350);
    make(PANE.lines, 420);
    make(PANE.wind, 430);
    make(PANE.labels, 440);
  }, [map]);
  useLayoutEffect(() => {
    const pane = map.getPane(PANE.field);
    if (pane) pane.style.opacity = String(opacity);
  }, [map, opacity]);
  return null;
}

/** Keep the view over the data: no panning off the Gulf grid, no zooming out past it. */
function ViewLimits({ field }: { field: WeatherField }) {
  const map = useMap();
  useEffect(() => {
    const { coarse } = field;
    const bounds = L.latLngBounds([coarse.south, coarse.west], [coarse.north, coarse.east]);
    const apply = () => {
      map.setMaxBounds(bounds);
      map.setMinZoom(Math.max(6, Math.ceil(map.getBoundsZoom(bounds, true) * 2) / 2));
    };
    apply();
    map.on("resize", apply);
    return () => {
      map.off("resize", apply);
    };
  }, [map, field]);
  return null;
}

function ViewController({
  farms,
  selectedId,
  fitSignal,
  focusSignal,
}: {
  farms: WeatherMapFarm[];
  selectedId: string | null;
  fitSignal: number;
  focusSignal: number;
}) {
  const map = useMap();
  const [initialFit] = useState(fitSignal);
  const [initialFocus] = useState(focusSignal);
  const fit = useEffectEvent(() => map.flyToBounds(QATAR_VIEW, { duration: 0.7 }));
  const focus = useEffectEvent(() => {
    const f = farms.find((x) => x.id === selectedId);
    if (f) map.flyTo([f.lat, f.lng], Math.max(map.getZoom(), 10), { duration: 0.7 });
  });
  useEffect(() => {
    if (fitSignal !== initialFit) fit();
  }, [fitSignal, initialFit]);
  useEffect(() => {
    if (focusSignal !== initialFocus) focus();
  }, [focusSignal, initialFocus]);
  return null;
}

function AttributionSetup({ position }: { position: L.ControlPosition }) {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
    map.attributionControl?.setPosition(position);
    map.attributionControl?.addAttribution(WEATHER_CREDIT);
    return () => {
      map.attributionControl?.removeAttribution(WEATHER_CREDIT);
    };
  }, [map, position]);
  return null;
}

// ---------------------------------------------------------------------------
// Colour field
// ---------------------------------------------------------------------------

/** One grid level painted into a canvas that Leaflet stretches over the level's bounds. */
const FieldOverlay = memo(function FieldOverlay({
  field,
  level,
  def,
  t,
  fast,
}: {
  field: WeatherField;
  level: "coarse" | "fine";
  def: WeatherLayerDef;
  t: number;
  fast: boolean;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lv = field[level];

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvasRef.current = canvas;
    const bounds = L.latLngBounds([lv.south, lv.west], [lv.north, lv.east]);
    // L.svgOverlay only positions and scales the element it is given, so a canvas works too.
    const layer = L.svgOverlay(canvas as unknown as SVGElement, bounds, { pane: PANE.field, interactive: false, className: "yai-wx-field" });
    layer.addTo(map);
    if (level === "coarse") layer.bringToBack();
    else layer.bringToFront();
    return () => {
      layer.remove();
      canvasRef.current = null;
    };
  }, [map, lv.south, lv.west, lv.north, lv.east, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = level === "coarse" ? (fast ? 220 : 420) : fast ? 240 : 480;
    const height = mercatorHeight(lv, width);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const slice = frameAt(lv, def.field, t);
    const pixels = renderLevel(lv, slice, def.field, lutFor(def.palette), width, height, level === "fine" ? 0.2 : 0);
    ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }, [lv, level, def, t, fast]);

  return null;
});

// ---------------------------------------------------------------------------
// Wind streaks and isolines
// ---------------------------------------------------------------------------

function WindLayer({ field, t, mode, tone }: { field: WeatherField; t: number; mode: StreakMode; tone: "light" | "dark" }) {
  const map = useMap();
  const ref = useRef<WindParticles | null>(null);
  useEffect(() => {
    const p = new WindParticles(map, PANE.wind);
    ref.current = p;
    return () => {
      p.destroy();
      ref.current = null;
    };
  }, [map]);
  useEffect(() => ref.current?.setTone(tone), [tone]);
  useEffect(() => ref.current?.setMode(mode), [mode]);
  useEffect(() => ref.current?.setData(field, t), [field, t]);
  return null;
}

function IsolineLayer({ field, def, t, enabled, tone }: { field: WeatherField; def: WeatherLayerDef; t: number; enabled: boolean; tone: "light" | "dark" }) {
  const map = useMap();
  const ref = useRef<IsolineCanvas | null>(null);
  useEffect(() => {
    const c = new IsolineCanvas(map, PANE.lines);
    ref.current = c;
    return () => {
      c.destroy();
      ref.current = null;
    };
  }, [map]);
  useEffect(() => ref.current?.set(field, def, t, enabled, tone), [field, def, t, enabled, tone]);
  return null;
}

// ---------------------------------------------------------------------------
// Farms, pin and pointer
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function farmIcon(name: string, value: number, def: WeatherLayerDef, selected: boolean, showName: boolean, windDeg: number | null): L.DivIcon {
  const c = paletteColor(def.palette, value);
  // Colours with little alpha (dry rain, clear sky) get a neutral chip.
  const solid = c[3] > 150;
  const bg = solid ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` : "rgba(20,28,24,0.82)";
  const fg = solid ? textOn(c) : "#ffffff";
  const text = formatWeather(def, value, false);
  const unit = def.unit === "°C" ? "°" : def.unit === "%" ? "%" : "";
  const arrow =
    windDeg != null
      ? `<svg class="yai-wx-arrow" viewBox="0 0 12 12" style="transform: rotate(${Math.round(windDeg + 180)}deg)" aria-hidden="true"><path d="M6 1 L9.5 9 L6 7.2 L2.5 9 Z" fill="currentColor"/></svg>`
      : "";
  const html = `<div class="yai-wx-farm${selected ? " is-selected" : ""}"><span class="yai-wx-dot"></span><span class="yai-wx-val" style="background:${bg};color:${fg}">${arrow}${escapeHtml(text)}${unit}</span>${showName ? `<span class="yai-wx-name">${escapeHtml(name)}</span>` : ""}</div>`;
  return L.divIcon({ className: "yai-divicon", html, iconSize: [0, 0], iconAnchor: [0, 0] });
}

function FarmMarker({
  farm,
  sampler,
  def,
  selected,
  showName,
  onSelect,
}: {
  farm: WeatherMapFarm;
  sampler: FieldSampler;
  def: WeatherLayerDef;
  selected: boolean;
  showName: boolean;
  onSelect?: (id: string) => void;
}) {
  const value = sampler.value(def.field, farm.lat, farm.lng);
  const wind = def.key === "wind" || def.key === "gust" ? sampler.wind(farm.lat, farm.lng) : null;
  const deg = wind ? windFromDeg(wind.u, wind.v) : null;
  const text = formatWeather(def, value, false);
  const icon = useMemo(() => farmIcon(farm.name, value, def, selected, showName, deg), [farm.name, value, def, selected, showName, deg]);
  return (
    <Marker
      position={[farm.lat, farm.lng]}
      icon={icon}
      zIndexOffset={selected ? 1000 : 0}
      keyboard
      title={`${farm.name}: ${def.short} ${text}${def.unit}`}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          onSelect?.(farm.id);
        },
      }}
    />
  );
}

let pinIconCache: L.DivIcon | null = null;
const pinIcon = () =>
  (pinIconCache ??= L.divIcon({
    className: "yai-divicon",
    html: '<div class="yai-wx-pin" aria-hidden="true"></div>',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  }));

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  const report = useEffectEvent(() => onZoom(map.getZoom()));
  useEffect(() => {
    report();
  }, []);
  return null;
}

function Pointer({ onHover, onClick }: { onHover: (h: WeatherHover | null) => void; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    mousemove: (e) => onHover({ x: e.containerPoint.x, y: e.containerPoint.y, lat: e.latlng.lat, lng: e.latlng.lng }),
    mouseout: () => onHover(null),
    movestart: () => onHover(null),
    click: (e) => onClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/** Value under the pointer, Windy-style: a small bubble next to the cursor. */
function HoverBubble({ hover, sampler, def }: { hover: WeatherHover; sampler: FieldSampler; def: WeatherLayerDef }) {
  const value = sampler.value(def.field, hover.lat, hover.lng);
  if (!Number.isFinite(value)) return null;
  const wind = def.key === "wind" || def.key === "gust" ? sampler.wind(hover.lat, hover.lng) : null;
  const c = paletteColor(def.palette, value);
  return (
    <div
      className="pointer-events-none absolute z-[1000] -translate-y-full rounded-md bg-forest-900/90 px-2 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-md"
      style={{ left: hover.x + 12, top: hover.y - 8 }}
      aria-hidden="true"
    >
      <span className="mr-1.5 inline-block size-2.5 rounded-full align-[-1px] ring-1 ring-white/40" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
      {formatWeather(def, value)}
      {wind ? <span className="ml-1.5 font-normal text-white/75">from {Math.round(windFromDeg(wind.u, wind.v))}°</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export default function WeatherMap({
  field,
  layer,
  t,
  fast = false,
  farms,
  selectedId = null,
  onSelectFarm,
  pin = null,
  onPin,
  basemap,
  streaks,
  isolines,
  opacity = 0.82,
  focus = null,
  scrollWheelZoom = true,
  gestureZoom = false,
  touchDrag = true,
  fitSignal = 0,
  focusSignal = 0,
  attributionPosition = "bottomright",
  zoomControl = true,
}: WeatherMapProps) {
  const def = WEATHER_LAYERS[layer];
  const sampler = useMemo(() => new FieldSampler(field, t), [field, t]);
  const [hover, setHover] = useState<WeatherHover | null>(null);
  const [zoom, setZoom] = useState(8);
  // Streaks read as white on the dark and satellite maps, as dark ink on the light one.
  const tone = basemap === "light" ? "dark" : "light";
  const [initial] = useState(() => (focus ? { center: L.latLng(focus.lat, focus.lng), zoom: focus.zoom } : null));

  return (
    <MapContainer
      {...(initial ? { center: initial.center, zoom: initial.zoom } : { bounds: QATAR_VIEW })}
      zoomSnap={0.5}
      zoomDelta={0.5}
      zoomControl={false}
      scrollWheelZoom={scrollWheelZoom}
      dragging={touchDrag || !L.Browser.mobile}
      maxZoom={12}
      minZoom={6}
      maxBoundsViscosity={1}
      className="yai-wx-map size-full"
      attributionControl
    >
      <Panes opacity={opacity} />
      {basemap === "satellite" ? (
        <>
          <TileLayer key="img" url={TILES.imagery} attribution="Imagery © Esri, Maxar, Earthstar Geographics" maxNativeZoom={18} />
          <TileLayer key="img-labels" url={TILES.imageryLabels} pane={PANE.labels} opacity={0.9} />
        </>
      ) : basemap === "light" ? (
        <>
          <TileLayer key="light" url={TILES.lightBase} attribution={CANVAS_CREDIT} maxNativeZoom={16} />
          <TileLayer key="light-labels" url={TILES.lightLabels} pane={PANE.labels} maxNativeZoom={16} />
        </>
      ) : (
        <>
          <TileLayer key="dark" url={TILES.darkBase} attribution={CANVAS_CREDIT} maxNativeZoom={16} />
          <TileLayer key="dark-labels" url={TILES.darkLabels} pane={PANE.labels} maxNativeZoom={16} />
        </>
      )}
      {zoomControl ? <ZoomControl position="topright" /> : null}

      <FieldOverlay field={field} level="coarse" def={def} t={t} fast={fast} />
      <FieldOverlay field={field} level="fine" def={def} t={t} fast={fast} />
      <Polyline positions={COASTS} pane={PANE.lines} interactive={false} pathOptions={{ color: tone === "light" ? "#ffffff" : "#1c2320", weight: 1.1, opacity: 0.7 }} />
      <Polyline positions={BORDERS} pane={PANE.lines} interactive={false} pathOptions={{ color: tone === "light" ? "#ffffff" : "#1c2320", weight: 1, opacity: 0.55, dashArray: "4 4" }} />
      <IsolineLayer field={field} def={def} t={t} enabled={isolines} tone={tone} />
      <WindLayer field={field} t={t} mode={streaks} tone={tone} />

      {farms.map((f) => (
        <FarmMarker
          key={f.id}
          farm={f}
          sampler={sampler}
          def={def}
          selected={f.id === selectedId}
          showName={f.id === selectedId || zoom >= 10 || farms.length === 1}
          onSelect={onSelectFarm}
        />
      ))}
      {pin ? <Marker position={[pin.lat, pin.lng]} icon={pinIcon()} interactive={false} keyboard={false} zIndexOffset={2000} /> : null}

      <Pointer onHover={setHover} onClick={(lat, lng) => onPin?.({ lat, lng })} />
      {hover ? <HoverBubble hover={hover} sampler={sampler} def={def} /> : null}
      <ZoomWatcher onZoom={setZoom} />
      <ViewLimits field={field} />
      <ViewController farms={farms} selectedId={selectedId} fitSignal={fitSignal} focusSignal={focusSignal} />
      <AttributionSetup position={attributionPosition} />
      {gestureZoom && !scrollWheelZoom ? <GestureZoom /> : null}
    </MapContainer>
  );
}
