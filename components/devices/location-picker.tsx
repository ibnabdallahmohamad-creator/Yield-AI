"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { squareFieldPolygon } from "@/lib/account/types";
import { toLatLngRing } from "@/lib/geo";

const TILE_ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ESRI_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
/** Qatar, when no point is chosen yet. */
const QATAR: [number, number] = [25.35, 51.2];

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6);
    },
  });
  return null;
}

/** Zoom at which the field square is clearly visible. */
const FIELD_ZOOM = 15;

/**
 * Keep the chosen point in view and close enough to see the field square: typed in, "use my
 * location", or a first rough click on the country map. Waits for typing to pause so a half-typed
 * "2" doesn't send the map to the equator.
 */
function FollowPoint({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const timer = setTimeout(() => {
      const zoom = map.getZoom();
      if (zoom < FIELD_ZOOM - 2 || !map.getBounds().contains([lat, lng])) map.setView([lat, lng], Math.max(zoom, FIELD_ZOOM));
    }, 500);
    return () => clearTimeout(timer);
  }, [lat, lng, map]);
  return null;
}

/** Satellite map: click where the farm is; the square shows its area around that point. */
export default function LocationPicker({
  lat,
  lng,
  areaHa,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  areaHa: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const has = lat != null && lng != null;
  const ring = has ? toLatLngRing(squareFieldPolygon(lat, lng, areaHa && areaHa > 0 ? areaHa : 1)) : null;
  return (
    <MapContainer
      center={has ? [lat, lng] : QATAR}
      zoom={has ? FIELD_ZOOM : 8}
      className="size-full cursor-crosshair"
      attributionControl
      scrollWheelZoom
    >
      <TileLayer url={TILE_ESRI_IMAGERY} attribution="Imagery © Esri, Maxar, Earthstar Geographics" maxNativeZoom={18} maxZoom={19} />
      <TileLayer url={TILE_ESRI_LABELS} maxNativeZoom={18} maxZoom={19} opacity={0.85} />
      <ClickToPick onPick={onPick} />
      <FollowPoint lat={lat} lng={lng} />
      {ring ? <Polygon positions={ring} pathOptions={{ color: "#fbbf24", weight: 2, fillOpacity: 0.15 }} /> : null}
    </MapContainer>
  );
}
