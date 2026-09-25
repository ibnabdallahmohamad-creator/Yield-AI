"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { memo, useEffect, useEffectEvent } from "react";
import { MapContainer, Marker, Rectangle, TileLayer, ZoomControl, useMap } from "react-leaflet";
import { cellColor, type AtlasCell, type AtlasLayer } from "@/lib/land/layers";

export interface AtlasMapProps {
  cells: AtlasCell[];
  layer: AtlasLayer;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Farms of the signed-in account, shown as pins. */
  farms: Array<{ id: string; name: string; lat: number; lng: number }>;
  flyTo?: { lat: number; lng: number; zoom: number; key: number } | null;
}

const TILE_CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function farmIcon(name: string) {
  return L.divIcon({
    className: "yai-divicon",
    html: `<div class="yai-drop-pin" style="--pin-color:#14532d"><span class="yai-drop-pin-label">${escapeHtml(name)}</span><svg viewBox="0 0 32 42" width="24" height="32" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1Z" fill="#14532d" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15.5" r="5.5" fill="#fff"/></svg></div>`,
    iconSize: [24, 32],
    iconAnchor: [12, 31],
  });
}

const Cells = memo(function Cells({ cells, layer, onSelect }: Pick<AtlasMapProps, "cells" | "layer" | "onSelect">) {
  return (
    <>
      {cells.map((c) => (
        <Rectangle
          key={c.id}
          bounds={[
            [c.b[0], c.b[1]],
            [c.b[2], c.b[3]],
          ]}
          pathOptions={{ color: "#ffffff", weight: 0.4, opacity: 0.7, fillColor: cellColor(layer, c), fillOpacity: 0.78 }}
          eventHandlers={{ click: () => onSelect(c.id) }}
        />
      ))}
    </>
  );
});

function FlyTo({ target }: { target: AtlasMapProps["flyTo"] }) {
  const map = useMap();
  const fly = useEffectEvent((t: NonNullable<AtlasMapProps["flyTo"]>) => map.flyTo([t.lat, t.lng], t.zoom, { duration: 0.8 }));
  useEffect(() => {
    if (target) fly(target);
  }, [target]);
  return null;
}

/** Qatar's 10 km² land cells coloured by the chosen layer; click a cell for its profile. */
export default function AtlasMap({ cells, layer, selectedId, onSelect, farms, flyTo }: AtlasMapProps) {
  const selected = cells.find((c) => c.id === selectedId);
  return (
    <MapContainer
      center={[25.33, 51.2]}
      zoom={9}
      zoomSnap={0.5}
      zoomControl={false}
      minZoom={7}
      maxZoom={17}
      preferCanvas
      className="size-full"
      attributionControl
    >
      <TileLayer
        url={TILE_CARTO_LIGHT}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Boundaries: geoBoundaries (CC BY 4.0)'
        subdomains="abcd"
        maxZoom={19}
      />
      <ZoomControl position="bottomright" />
      <FlyTo target={flyTo} />
      <Cells cells={cells} layer={layer} onSelect={onSelect} />
      {selected ? (
        <Rectangle
          bounds={[
            [selected.b[0], selected.b[1]],
            [selected.b[2], selected.b[3]],
          ]}
          pathOptions={{ color: "#111827", weight: 2.5, fill: false }}
          interactive={false}
        />
      ) : null}
      {farms.map((f) => (
        <Marker key={f.id} position={[f.lat, f.lng]} icon={farmIcon(f.name)} keyboard={false} interactive={false} />
      ))}
    </MapContainer>
  );
}
