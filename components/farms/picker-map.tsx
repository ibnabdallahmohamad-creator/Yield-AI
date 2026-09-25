"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useEffectEvent } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import { polygonBounds, toLatLngRing, type GeoPolygon, type LngLat } from "@/lib/geo";

export type PickerBasemap = "satellite" | "streets";

export interface PickerSensor {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

export interface PickerMapProps {
  basemap: PickerBasemap;
  /** Initial view: a field outline to fit, or a centre + zoom. */
  initial: { outline?: GeoPolygon | null; center?: [number, number]; zoom?: number };
  /** The dropped pin (farm location or the next sensor's position). */
  pin: { lat: number; lng: number } | null;
  pinLabel?: string;
  /** Map click / pin drag in pin mode. */
  onPick?: (lat: number, lng: number) => void;
  /** "outline": clicks add field corners instead of moving the pin. */
  mode?: "pin" | "outline";
  onOutlinePoint?: (point: LngLat) => void;
  /** The farm's field outline (saved or preview). */
  outline?: GeoPolygon | null;
  /** Corners drawn so far in outline mode. */
  draft?: LngLat[];
  sensors?: PickerSensor[];
  /** Change `key` to fly the map to a point (e.g. a search result). */
  flyTo?: { lat: number; lng: number; zoom: number; key: number } | null;
}

const TILE_ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TILE_CARTO_VOYAGER = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

/** Qatar as a whole — the default view before anything is picked. */
export const QATAR_CENTER: [number, number] = [25.3, 51.2];
export const QATAR_ZOOM = 9;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function dropPinIcon(label?: string): L.DivIcon {
  const tag = label ? `<span class="yai-drop-pin-label">${escapeHtml(label)}</span>` : "";
  return L.divIcon({
    className: "yai-divicon",
    html: `<div class="yai-drop-pin">${tag}<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1Z" fill="var(--pin-color, #2f6f4f)" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15.5" r="5.5" fill="#fff"/></svg></div>`,
    iconSize: [32, 42],
    iconAnchor: [16, 41],
  });
}

function ClickHandler({ mode, onPick, onOutlinePoint }: Pick<PickerMapProps, "mode" | "onPick" | "onOutlinePoint">) {
  useMapEvents({
    click(e) {
      if (mode === "outline") onOutlinePoint?.([e.latlng.lng, e.latlng.lat]);
      else onPick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyTo({ target }: { target: PickerMapProps["flyTo"] }) {
  const map = useMap();
  const fly = useEffectEvent((t: NonNullable<PickerMapProps["flyTo"]>) => {
    map.invalidateSize({ pan: false });
    map.flyTo([t.lat, t.lng], t.zoom, { duration: 0.9 });
  });
  useEffect(() => {
    if (target) fly(target);
  }, [target]);
  return null;
}

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

/** Map for placing a farm or sensor: click to drop the pin, drag it to adjust, or draw the field outline. */
export default function PickerMap({
  basemap,
  initial,
  pin,
  pinLabel,
  onPick,
  mode = "pin",
  onOutlinePoint,
  outline,
  draft = [],
  sensors = [],
  flyTo,
}: PickerMapProps) {
  const bounds = initial.outline ? polygonBounds(initial.outline) : null;
  const view = bounds
    ? { bounds: L.latLngBounds([bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]).pad(0.6) }
    : { center: initial.center ?? QATAR_CENTER, zoom: initial.zoom ?? QATAR_ZOOM };

  return (
    <MapContainer
      {...view}
      zoomSnap={0.5}
      zoomControl={false}
      maxZoom={19}
      minZoom={7}
      className={mode === "outline" ? "size-full cursor-crosshair" : "size-full"}
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
      <ZoomControl position="bottomright" />
      <SizeWatcher />
      <ClickHandler mode={mode} onPick={onPick} onOutlinePoint={onOutlinePoint} />
      <FlyTo target={flyTo} />

      {outline ? (
        <Polygon
          positions={toLatLngRing(outline)}
          pathOptions={{ color: "#fff", weight: 2.5, fillColor: "#3f9b6e", fillOpacity: 0.22, dashArray: mode === "outline" ? "6 6" : undefined }}
          interactive={false}
        />
      ) : null}
      {draft.length > 0 ? (
        <>
          <Polyline positions={draft.map(([lng, lat]) => [lat, lng] as [number, number])} pathOptions={{ color: "#facc15", weight: 3 }} interactive={false} />
          {draft.map(([lng, lat], i) => (
            <CircleMarker
              key={`${lng},${lat},${i}`}
              center={[lat, lng]}
              radius={5}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "#facc15", fillOpacity: 1 }}
              interactive={false}
            />
          ))}
        </>
      ) : null}

      {sensors.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={7}
          pathOptions={{ color: "#fff", weight: 2.5, fillColor: "#0f766e", fillOpacity: 1 }}
        >
          <Tooltip direction="top" offset={[0, -6]} permanent className="yai-sensor-tip">
            {s.label ? `${s.id} · ${s.label}` : s.id}
          </Tooltip>
        </CircleMarker>
      ))}

      {pin ? (
        <Marker
          position={[pin.lat, pin.lng]}
          icon={dropPinIcon(pinLabel)}
          draggable={Boolean(onPick) && mode === "pin"}
          keyboard={false}
          eventHandlers={{
            dragend(e) {
              const ll = (e.target as L.Marker).getLatLng();
              onPick?.(ll.lat, ll.lng);
            },
          }}
        />
      ) : null}
    </MapContainer>
  );
}
