"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Fragment, memo, useEffect, useEffectEvent, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import type { ProbeSample } from "@/lib/dashboard";
import { localProjector, polygonBounds, toLatLngRing, type GeoPolygon } from "@/lib/geo";
import { idwValue } from "@/lib/idw";
import { colorFor, colorRgb, formatValue, readableTextOn, type Delta, type MetricDef } from "@/lib/metrics";
import { estimateTextWidth, layoutPins, type PinInput, type Side } from "@/lib/pin-layout";
import type { MapSync } from "./map-sync";
import { RasterLayer } from "./raster-layer";

export type Basemap = "satellite" | "streets";

/** Space (px) kept free around the fitted farm(s), e.g. for controls floating over the map. */
export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapFarm {
  id: string;
  name: string;
  polygon: GeoPolygon;
  /** Farm-level value of the current metric on the shown day. */
  value: number | null;
  /** Per-probe values for the IDW layer and probe dots. */
  samples: ProbeSample[];
  /** Compare mode: change since the "then" day. */
  delta?: Delta | null;
}

export interface FarmMapProps {
  farms: MapFarm[];
  metric: MetricDef;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  basemap: Basemap;
  /** Live mode: farm that just reported (the key restarts the pulse animation). */
  pulse?: { farmId: string; at: number } | null;
  /** Leader handles fly-to / fit-all; followers mirror its view (compare mode). */
  role?: "leader" | "follower";
  sync?: MapSync | null;
  /** Increment to zoom out to all farms. */
  fitAllSignal?: number;
  /** Increment to zoom back to the selected farm. */
  focusSignal?: number;
  initialView?: "selected" | "all";
  scrollWheelZoom?: boolean;
  /** Show the farm-name tag of the selected farm. */
  showSelectedName?: boolean;
  /** Called when the zoom crosses between the pin view and the field view. */
  onFieldViewChange?: (fieldView: boolean) => void;
  /** Free space around fitted farms (defaults leave room for the name tag). */
  padding?: MapPadding;
  /** Fly to a farm when it is selected (off for the landing-page overview). */
  followSelection?: boolean;
  /** One-finger panning on phones (off where the page must keep scrolling). */
  touchDrag?: boolean;
  /** With `scrollWheelZoom` off: zoom with Ctrl/⌘ + wheel or a trackpad pinch instead. */
  gestureZoom?: boolean;
  attributionPosition?: L.ControlPosition;
}

/** Below this zoom farms are pins; from it on, fields with the interpolated raster. */
export const FIELD_ZOOM = 14;
const PROBE_ZOOM = 15;
const LABEL_ZOOM = 16;
const FOCUS_MAX_ZOOM = 17;
const PIN_R = 18;
const PIN_R_SELECTED = 22;
const DEFAULT_PADDING: MapPadding = { top: 64, right: 48, bottom: 40, left: 48 };

const fitOptions = (p: MapPadding): L.FitBoundsOptions => ({
  paddingTopLeft: L.point(p.left, p.top),
  paddingBottomRight: L.point(p.right, p.bottom),
});

const TILE_ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TILE_CARTO_VOYAGER = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function boundsOf(polygon: GeoPolygon): L.LatLngBounds {
  const b = polygonBounds(polygon);
  return L.latLngBounds([b.minLat, b.minLng], [b.maxLat, b.maxLng]);
}

function allBounds(farms: MapFarm[]): L.LatLngBounds | null {
  if (farms.length === 0) return null;
  const b = boundsOf(farms[0].polygon);
  for (const f of farms.slice(1)) b.extend(boundsOf(f.polygon));
  return b;
}

function centerOf(polygon: GeoPolygon): [number, number] {
  const b = polygonBounds(polygon);
  return [(b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2];
}

function pinIcon(metric: MetricDef, farm: MapFarm, selected: boolean): L.DivIcon {
  const rgb = farm.value != null ? colorRgb(metric, farm.value) : ([156, 163, 175] as [number, number, number]);
  const size = 2 * (selected ? PIN_R_SELECTED : PIN_R);
  const text = farm.value != null ? formatValue(metric, farm.value, false) : "—";
  return L.divIcon({
    className: "yai-divicon",
    html: `<div class="yai-pin${selected ? " is-selected" : ""}" style="--pin-bg: rgb(${rgb.map(Math.round).join(",")}); --pin-fg: ${readableTextOn(rgb)}; width: ${size}px; height: ${size}px;"><span>${escapeHtml(text)}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 - 2],
  });
}

const deltaSpan = (delta: Delta, text: string) =>
  `<span class="yai-tag-delta yai-delta-${delta.tone}">${escapeHtml(text)}</span>`;

/**
 * Name tag with the compare delta (e.g. "Salinity +18%"): above a field's north edge when zoomed in,
 * above or below the selected pin in the overview.
 */
function nameTagIcon(
  name: string | null,
  delta: Delta | null | undefined,
  metric: MetricDef,
  placement: "field" | "top" | "bottom",
): L.DivIcon {
  const nameHtml = name ? `<span class="yai-tag-name">${escapeHtml(name)}</span>` : "";
  const deltaHtml = delta ? deltaSpan(delta, `${metric.short} ${delta.text}`) : "";
  const lift = placement === "field" ? 6 : PIN_R_SELECTED + 6;
  const html = `<div class="yai-tag${placement === "bottom" ? " is-below" : ""}" style="--lift: ${lift}px">${nameHtml}${deltaHtml}</div>`;
  return L.divIcon({ className: "yai-divicon", html, iconSize: [0, 0], iconAnchor: [0, 0] });
}

/** Compact compare badge beside an overview pin, on the side the layout found free. */
function badgeIcon(delta: Delta, side: Side, r: number): L.DivIcon {
  const html = `<div class="yai-badge" data-side="${side}" style="--r: ${r}px">${deltaSpan(delta, delta.text)}</div>`;
  return L.divIcon({ className: "yai-divicon", html, iconSize: [0, 0], iconAnchor: [0, 0] });
}

// Size estimates for the layout (match .yai-tag-name / .yai-badge in globals.css).
const BADGE_H = 18;
const TAG_H = 24;
const badgeWidth = (text: string) => estimateTextWidth(text, 10.5, true) + 14;
function tagWidth(name: string, deltaText: string | null): number {
  const nameW = estimateTextWidth(name, 12, true) + 20;
  return deltaText ? nameW + 4 + estimateTextWidth(deltaText, 11.5, true) + 18 : nameW;
}

let pulseIconCache: L.DivIcon | null = null;
const pulseIcon = () =>
  (pulseIconCache ??= L.divIcon({
    className: "yai-divicon",
    html: '<div class="yai-pulse"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  }));

// ---------------------------------------------------------------------------
// Behaviour components
// ---------------------------------------------------------------------------

function ViewController({
  farms,
  selectedId,
  fitAllSignal,
  focusSignal,
  padding,
  followSelection,
}: {
  farms: MapFarm[];
  selectedId: string | null;
  fitAllSignal: number;
  focusSignal: number;
  padding: MapPadding;
  followSelection: boolean;
}) {
  const map = useMap();
  const [initialSelected] = useState(selectedId);
  const [initialFitAll] = useState(fitAllSignal);
  const [initialFocus] = useState(focusSignal);

  // invalidateSize first: the pane may have just been resized (compare mode splits it in two).
  const flyToSelected = useEffectEvent(() => {
    const farm = farms.find((f) => f.id === selectedId);
    map.invalidateSize({ pan: false });
    if (farm) map.flyToBounds(boundsOf(farm.polygon), { ...fitOptions(padding), maxZoom: FOCUS_MAX_ZOOM, duration: 0.8 });
  });
  const flyToAll = useEffectEvent(() => {
    const b = allBounds(farms);
    map.invalidateSize({ pan: false });
    if (b) map.flyToBounds(b, { ...fitOptions(padding), duration: 0.8 });
  });

  useEffect(() => {
    if (followSelection && selectedId !== initialSelected) flyToSelected();
  }, [selectedId, initialSelected, followSelection]);
  useEffect(() => {
    if (fitAllSignal !== initialFitAll) flyToAll();
  }, [fitAllSignal, initialFitAll]);
  useEffect(() => {
    if (focusSignal !== initialFocus) flyToSelected();
  }, [focusSignal, initialFocus]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  const report = useEffectEvent(() => onZoom(map.getZoom()));
  useEffect(() => {
    report();
  }, []);
  return null;
}

function SyncBridge({ sync, role }: { sync: MapSync; role: "leader" | "follower" }) {
  const map = useMap();
  useEffect(() => {
    const remove = sync.add(map, role);
    const onMove = () => sync.moved(map);
    map.on("move", onMove);
    return () => {
      map.off("move", onMove);
      remove();
    };
  }, [map, sync, role]);
  return null;
}

/** Leaflet does not notice container resizes (e.g. compare mode halving the width). */
function SizeWatcher() {
  const map = useMap();
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });
    observer.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

/** Attribution without the Leaflet prefix, where the page wants it (the provider credit stays). */
function AttributionSetup({ position }: { position: L.ControlPosition }) {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
    map.attributionControl?.setPosition(position);
  }, [map, position]);
  return null;
}

/**
 * On a page that scrolls, the wheel scrolls the page and Ctrl/⌘ + wheel (or a trackpad pinch,
 * which browsers report as Ctrl + wheel) zooms the map. A plain wheel shows a short hint.
 */
function GestureZoom() {
  const map = useMap();
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const el = map.getContainer();
    let timer: number | undefined;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        acc += -e.deltaY * (e.deltaMode === 1 ? 33 : 1);
        if (Math.abs(acc) < 40) return;
        const step = acc > 0 ? 0.5 : -0.5;
        acc = 0;
        map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + step);
        setHint(false);
        return;
      }
      setHint(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHint(false), 1500);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(timer);
    };
  }, [map]);
  if (!hint) return null;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[1000] flex -translate-y-1/2 justify-center" aria-hidden="true">
      <span className="rounded-full bg-forest-900/85 px-4 py-2 text-sm font-medium text-primary-foreground shadow-md">
        Hold {mac ? "⌘" : "Ctrl"} and scroll to zoom the map
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const FieldLayer = memo(function FieldLayer({
  farm,
  metric,
  selected,
  basemap,
  onSelect,
}: {
  farm: MapFarm;
  metric: MetricDef;
  selected: boolean;
  basemap: Basemap;
  onSelect?: (id: string) => void;
}) {
  const ring = useMemo(() => toLatLngRing(farm.polygon), [farm.polygon]);
  const [cursor, setCursor] = useState<number | null>(null);
  const projected = useMemo(() => {
    const [lat0, lng0] = centerOf(farm.polygon);
    const proj = localProjector(lat0, lng0);
    return {
      proj,
      samples: farm.samples.map((s) => {
        const [x, y] = proj.toXY(s.lng, s.lat);
        return { x, y, value: s.value };
      }),
    };
  }, [farm.polygon, farm.samples]);

  const hasData = metric.spatial ? farm.samples.length > 0 : farm.value != null;
  const outline = basemap === "satellite" ? "#ffffff" : "#1f5a3d";
  // Before the pointer moves (a tap, a scroll) there is no interpolated point yet: show the farm mean.
  const hoverValue = metric.spatial && cursor != null ? cursor : farm.value;

  return (
    <>
      {hasData ? (
        <RasterLayer
          polygon={farm.polygon}
          samples={farm.samples}
          metric={metric}
          uniformValue={metric.spatial ? undefined : farm.value}
        />
      ) : null}
      {selected ? (
        <Polygon positions={ring} interactive={false} pathOptions={{ color: "#0b1f16", weight: 6, opacity: 0.35, fill: false }} />
      ) : null}
      <Polygon
        positions={ring}
        pathOptions={{
          color: outline,
          weight: selected ? 2.5 : 1.5,
          opacity: selected ? 1 : 0.85,
          dashArray: selected ? undefined : "5 4",
          fill: true,
          fillColor: "#9ca3af",
          fillOpacity: hasData ? 0 : 0.35,
        }}
        eventHandlers={{
          click: () => onSelect?.(farm.id),
          mousemove: (e) => {
            if (!metric.spatial || projected.samples.length === 0) return;
            const [x, y] = projected.proj.toXY(e.latlng.lng, e.latlng.lat);
            setCursor(idwValue(projected.samples, x, y));
          },
          mouseout: () => setCursor(null),
        }}
      >
        <Tooltip sticky direction="top" offset={[0, -10]} className="yai-hover">
          <div className="font-semibold">{farm.name}</div>
          <div className="tabular text-muted-foreground">
            {hasData ? (
              <>
                {metric.short} {formatValue(metric, hoverValue)}
                {metric.spatial ? (cursor != null ? " · interpolated here" : " · farm mean") : ""}
              </>
            ) : (
              "No readings on this day"
            )}
          </div>
        </Tooltip>
      </Polygon>
    </>
  );
});

const ProbeLayer = memo(function ProbeLayer({
  farm,
  metric,
  selected,
  showLabels,
  onSelect,
}: {
  farm: MapFarm;
  metric: MetricDef;
  selected: boolean;
  showLabels: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <>
      {farm.samples.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={selected ? 6.5 : 5}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: colorFor(metric, s.value), fillOpacity: 1 }}
          eventHandlers={{ click: () => onSelect?.(farm.id) }}
        >
          {/* Distinct keys: react-leaflet cannot switch a tooltip between permanent and hover in place. */}
          {showLabels && metric.spatial ? (
            <Tooltip key="label" permanent direction="right" offset={[7, 0]} className="yai-label">
              {formatValue(metric, s.value, false)}
            </Tooltip>
          ) : (
            <Tooltip key="hover" direction="top" offset={[0, -6]} className="yai-hover">
              <span className="font-semibold">Probe {s.id}</span>
              <span className="tabular"> · {formatValue(metric, s.value)}</span>
            </Tooltip>
          )}
        </CircleMarker>
      ))}
    </>
  );
});

function PinLayer({
  farm,
  metric,
  selected,
  position,
  onSelect,
}: {
  farm: MapFarm;
  metric: MetricDef;
  selected: boolean;
  position: L.LatLngExpression;
  onSelect?: (id: string) => void;
}) {
  const icon = useMemo(() => pinIcon(metric, farm, selected), [metric, farm, selected]);
  return (
    <Marker
      position={position}
      icon={icon}
      zIndexOffset={selected ? 1000 : 0}
      keyboard
      title={`${farm.name}: ${metric.short} ${formatValue(metric, farm.value)}`}
      eventHandlers={{ click: () => onSelect?.(farm.id) }}
    >
      {!selected ? (
        <Tooltip direction="top" offset={[0, -4]} className="yai-hover">
          <div className="font-semibold">{farm.name}</div>
          <div className="tabular text-muted-foreground">
            {metric.short} {formatValue(metric, farm.value)}
          </div>
        </Tooltip>
      ) : null}
    </Marker>
  );
}

function IconMarker({ position, icon, zIndexOffset }: { position: L.LatLngExpression; icon: L.DivIcon; zIndexOffset: number }) {
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} zIndexOffset={zIndexOffset} />;
}

function BadgeMarker({ position, delta, side, r }: { position: L.LatLngExpression; delta: Delta; side: Side; r: number }) {
  const icon = useMemo(() => badgeIcon(delta, side, r), [delta, side, r]);
  return <IconMarker position={position} icon={icon} zIndexOffset={1500} />;
}

function NameTagMarker({
  position,
  name,
  delta,
  metric,
  placement,
}: {
  position: L.LatLngExpression;
  name: string | null;
  delta: Delta | null | undefined;
  metric: MetricDef;
  placement: "field" | "top" | "bottom";
}) {
  const icon = useMemo(() => nameTagIcon(name, delta, metric, placement), [name, delta, metric, placement]);
  return <IconMarker position={position} icon={icon} zIndexOffset={2000} />;
}

/**
 * Zoomed-out view: one pin per farm. Neighbouring farms overlap at this scale, so the pins are
 * spread apart in screen space (with a leader line back to the farm) and each compare badge
 * goes on a free side of its pin.
 */
function OverviewLayer({
  farms,
  metric,
  selectedId,
  zoom,
  showSelectedName,
  pulse,
  onSelect,
}: {
  farms: MapFarm[];
  metric: MetricDef;
  selectedId: string | null;
  zoom: number;
  showSelectedName: boolean;
  pulse?: { farmId: string; at: number } | null;
  onSelect?: (id: string) => void;
}) {
  const map = useMap();
  const layout = useMemo(() => {
    const inputs: PinInput[] = farms.map((farm) => {
      const selected = farm.id === selectedId;
      const point = map.project(centerOf(farm.polygon), zoom);
      return {
        id: farm.id,
        x: point.x,
        y: point.y,
        r: selected ? PIN_R_SELECTED : PIN_R,
        fixed: selected,
        badge: !selected && farm.delta ? { w: badgeWidth(farm.delta.text), h: BADGE_H } : null,
      };
    });
    const selected = farms.find((f) => f.id === selectedId);
    const tag =
      selected && showSelectedName
        ? {
            pinId: selected.id,
            w: tagWidth(selected.name, selected.delta ? `${metric.short} ${selected.delta.text}` : null),
            h: TAG_H,
            gap: 6,
          }
        : null;
    const { pins, tagSide } = layoutPins(inputs, tag);
    return {
      tagSide,
      pins: new Map(pins.map((p) => [p.id, { ...p, latLng: map.unproject([p.x, p.y], zoom) }])),
    };
  }, [map, farms, selectedId, zoom, showSelectedName, metric.short]);

  const selected = farms.find((f) => f.id === selectedId);
  const selectedPlace = selected ? layout.pins.get(selected.id) : undefined;
  const pulsePlace = pulse ? layout.pins.get(pulse.farmId) : undefined;

  return (
    <>
      {farms.map((farm) => {
        const place = layout.pins.get(farm.id);
        if (!place?.displaced) return null;
        const origin = centerOf(farm.polygon);
        return (
          <Fragment key={`leader-${farm.id}`}>
            <Polyline positions={[origin, place.latLng]} interactive={false} pathOptions={{ color: "#ffffff", weight: 3.5, opacity: 0.85 }} />
            <Polyline positions={[origin, place.latLng]} interactive={false} pathOptions={{ color: "#0b1f16", weight: 1.25, opacity: 0.8 }} />
            <CircleMarker
              center={origin}
              radius={3}
              interactive={false}
              pathOptions={{ color: "#0b1f16", weight: 1.25, fillColor: "#ffffff", fillOpacity: 1 }}
            />
          </Fragment>
        );
      })}
      {farms.map((farm) => {
        const place = layout.pins.get(farm.id);
        return place ? (
          <PinLayer
            key={`pin-${farm.id}`}
            farm={farm}
            metric={metric}
            selected={farm.id === selectedId}
            position={place.latLng}
            onSelect={onSelect}
          />
        ) : null;
      })}
      {farms.map((farm) => {
        const place = layout.pins.get(farm.id);
        return farm.delta && place?.badgeSide ? (
          <BadgeMarker key={`badge-${farm.id}`} position={place.latLng} delta={farm.delta} side={place.badgeSide} r={PIN_R} />
        ) : null;
      })}
      {selected && selectedPlace && showSelectedName ? (
        <NameTagMarker
          position={selectedPlace.latLng}
          name={selected.name}
          delta={selected.delta}
          metric={metric}
          placement={layout.tagSide}
        />
      ) : null}
      {pulse && pulsePlace ? (
        <Marker key={pulse.at} position={pulsePlace.latLng} icon={pulseIcon()} interactive={false} keyboard={false} />
      ) : null}
    </>
  );
}

/** Zoomed-in view: the name tag (and compare delta) above each field's north edge. */
function FieldTag({ farm, metric, showName }: { farm: MapFarm; metric: MetricDef; showName: boolean }) {
  const position = useMemo<[number, number]>(() => {
    const b = polygonBounds(farm.polygon);
    return [b.maxLat, (b.minLng + b.maxLng) / 2];
  }, [farm.polygon]);
  if (!showName && !farm.delta) return null;
  return <NameTagMarker position={position} name={showName ? farm.name : null} delta={farm.delta} metric={metric} placement="field" />;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export default function FarmMap({
  farms,
  metric,
  selectedId,
  onSelect,
  basemap,
  pulse,
  role = "leader",
  sync,
  fitAllSignal = 0,
  focusSignal = 0,
  initialView = "selected",
  scrollWheelZoom = true,
  showSelectedName = true,
  onFieldViewChange,
  padding = DEFAULT_PADDING,
  followSelection = true,
  touchDrag = true,
  gestureZoom = false,
  attributionPosition = "bottomright",
}: FarmMapProps) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [initialBounds] = useState(() => {
    const selected = farms.find((f) => f.id === selectedId);
    return initialView === "selected" && selected ? boundsOf(selected.polygon) : allBounds(farms);
  });

  const fieldView = zoom != null && zoom >= FIELD_ZOOM;
  const showProbes = zoom != null && zoom >= PROBE_ZOOM;
  const showLabels = zoom != null && zoom >= LABEL_ZOOM;
  const pulseFarm = pulse ? farms.find((f) => f.id === pulse.farmId) : null;

  const reportFieldView = useEffectEvent((value: boolean) => onFieldViewChange?.(value));
  useEffect(() => {
    if (zoom != null) reportFieldView(fieldView);
  }, [fieldView, zoom]);

  if (!initialBounds) return null;

  return (
    <MapContainer
      bounds={initialBounds}
      boundsOptions={{ ...fitOptions(padding), maxZoom: FOCUS_MAX_ZOOM }}
      zoomSnap={0.5}
      zoomDelta={1}
      zoomControl={false}
      scrollWheelZoom={scrollWheelZoom}
      dragging={touchDrag || !L.Browser.mobile}
      maxZoom={19}
      minZoom={7}
      className="size-full"
      attributionControl
    >
      {basemap === "satellite" ? (
        <>
          <TileLayer
            key="imagery"
            url={TILE_ESRI_IMAGERY}
            attribution="Imagery © Esri, Maxar, Earthstar Geographics &amp; the GIS User Community"
            maxNativeZoom={18}
            maxZoom={19}
          />
          <TileLayer key="labels" url={TILE_ESRI_LABELS} maxNativeZoom={18} maxZoom={19} opacity={0.85} />
        </>
      ) : (
        <TileLayer
          key="streets"
          url={TILE_CARTO_VOYAGER}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />
      )}
      {role === "leader" ? <ZoomControl position="topright" /> : null}

      {fieldView
        ? farms.map((farm) => (
            <FieldLayer
              key={`field-${farm.id}`}
              farm={farm}
              metric={metric}
              selected={farm.id === selectedId}
              basemap={basemap}
              onSelect={onSelect}
            />
          ))
        : null}
      {zoom != null && !fieldView ? (
        <OverviewLayer
          farms={farms}
          metric={metric}
          selectedId={selectedId}
          zoom={zoom}
          showSelectedName={showSelectedName}
          pulse={pulse}
          onSelect={onSelect}
        />
      ) : null}
      {showProbes
        ? farms.map((farm) => (
            <ProbeLayer
              key={`probes-${farm.id}`}
              farm={farm}
              metric={metric}
              selected={farm.id === selectedId}
              showLabels={showLabels}
              onSelect={onSelect}
            />
          ))
        : null}
      {fieldView
        ? farms.map((farm) => (
            <FieldTag key={`tag-${farm.id}`} farm={farm} metric={metric} showName={showSelectedName && farm.id === selectedId} />
          ))
        : null}
      {fieldView && pulse && pulseFarm ? (
        <Marker key={pulse.at} position={centerOf(pulseFarm.polygon)} icon={pulseIcon()} interactive={false} keyboard={false} />
      ) : null}

      <ZoomWatcher onZoom={setZoom} />
      <SizeWatcher />
      <AttributionSetup position={attributionPosition} />
      {gestureZoom && !scrollWheelZoom ? <GestureZoom /> : null}
      {role === "leader" ? (
        <ViewController
          farms={farms}
          selectedId={selectedId}
          fitAllSignal={fitAllSignal}
          focusSignal={focusSignal}
          padding={padding}
          followSelection={followSelection}
        />
      ) : null}
      {sync ? <SyncBridge sync={sync} role={role} /> : null}
    </MapContainer>
  );
}
