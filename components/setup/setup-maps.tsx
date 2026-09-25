"use client";

/**
 * Maps for the setup page: outline a field (click to add corners, drag to adjust) and place a
 * probe inside it. Leaflet touches `window`, so these load through next/dynamic (see index.tsx).
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { polygonBounds, toLatLngRing, type GeoPolygon, type LngLat } from "@/lib/geo";

const TILE_ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/** Northern Qatar, where the app's farms usually are. */
export const DEFAULT_CENTER: [number, number] = [25.55, 51.3];

function Basemap() {
  return (
    <>
      <TileLayer
        url={TILE_ESRI_IMAGERY}
        attribution="Imagery © Esri, Maxar, Earthstar Geographics &amp; the GIS User Community"
        maxNativeZoom={18}
        maxZoom={19}
      />
      <TileLayer url={TILE_ESRI_LABELS} maxNativeZoom={18} maxZoom={19} opacity={0.85} />
    </>
  );
}

const vertexIcon = (first: boolean) =>
  L.divIcon({
    className: "yai-divicon",
    html: `<div class="yai-vertex${first ? " is-first" : ""}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const probeIcon = (label: string, active: boolean) =>
  L.divIcon({
    className: "yai-divicon",
    html: `<div class="yai-probe${active ? " is-active" : ""}"><span>${label.replace(/[&<>"']/g, "")}</span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Fly to a requested point (e.g. "Use my location"); `request.at` makes repeated requests fire. */
function FlyTo({ request }: { request: { lat: number; lng: number; at: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (request) map.flyTo([request.lat, request.lng], 16, { duration: 0.8 });
  }, [map, request]);
  return null;
}

function boundsFor(polygons: GeoPolygon[]): L.LatLngBounds | null {
  if (polygons.length === 0) return null;
  const b = polygonBounds(polygons[0]);
  const out = L.latLngBounds([b.minLat, b.minLng], [b.maxLat, b.maxLng]);
  for (const p of polygons.slice(1)) {
    const pb = polygonBounds(p);
    out.extend(L.latLngBounds([pb.minLat, pb.minLng], [pb.maxLat, pb.maxLng]));
  }
  return out;
}

/** Outline a field: click to add corners, drag a corner to move it. */
export function BoundaryMap({
  vertices,
  onChange,
  otherFarms = [],
  flyTo = null,
}: {
  vertices: LngLat[];
  onChange: (vertices: LngLat[]) => void;
  /** The account's other farms, drawn faintly for orientation. */
  otherFarms?: GeoPolygon[];
  flyTo?: { lat: number; lng: number; at: number } | null;
}) {
  const initial = useMemo(() => {
    if (vertices.length >= 3) {
      return boundsFor([{ type: "Polygon", coordinates: [[...vertices, vertices[0]]] }]);
    }
    return boundsFor(otherFarms);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the first view
  }, []);
  const latLngs = vertices.map(([lng, lat]) => [lat, lng] as [number, number]);

  return (
    <MapContainer
      {...(initial ? { bounds: initial, boundsOptions: { padding: [40, 40], maxZoom: 17 } } : { center: DEFAULT_CENTER, zoom: 10 })}
      maxZoom={19}
      className="size-full"
      doubleClickZoom={false}
    >
      <Basemap />
      {otherFarms.map((p, i) => (
        <Polygon
          key={i}
          positions={toLatLngRing(p)}
          interactive={false}
          pathOptions={{ color: "#ffffff", weight: 1.5, dashArray: "5 4", fillColor: "#ffffff", fillOpacity: 0.12 }}
        />
      ))}
      {latLngs.length >= 3 ? (
        <Polygon positions={latLngs} interactive={false} pathOptions={{ color: "#fde047", weight: 2.5, fillColor: "#fde047", fillOpacity: 0.22 }} />
      ) : latLngs.length === 2 ? (
        <Polyline positions={latLngs} interactive={false} pathOptions={{ color: "#fde047", weight: 2.5 }} />
      ) : null}
      {latLngs.map((pos, i) => (
        <Marker
          key={`${i}-${pos[0]}-${pos[1]}`}
          position={pos}
          icon={vertexIcon(i === 0)}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              onChange(vertices.map((v, j) => (j === i ? [ll.lng, ll.lat] : v)));
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            Corner {i + 1} · drag to move
          </Tooltip>
        </Marker>
      ))}
      <ClickHandler onClick={(lat, lng) => onChange([...vertices, [lng, lat]])} />
      <FlyTo request={flyTo} />
    </MapContainer>
  );
}

/** Place a probe inside its field: click or drag the marker. */
export function ProbeMap({
  polygon,
  position,
  onChange,
  others = [],
  label,
}: {
  polygon: GeoPolygon;
  position: { lat: number; lng: number };
  onChange: (position: { lat: number; lng: number }) => void;
  /** Other probes on the farm. */
  others?: Array<{ id: string; lat: number; lng: number }>;
  label: string;
}) {
  const bounds = useMemo(() => boundsFor([polygon]), [polygon]);
  return (
    <MapContainer
      bounds={bounds ?? undefined}
      boundsOptions={{ padding: [30, 30], maxZoom: 18 }}
      maxZoom={19}
      className="size-full"
      doubleClickZoom={false}
    >
      <Basemap />
      <Polygon
        positions={toLatLngRing(polygon)}
        interactive={false}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#ffffff", fillOpacity: 0.1 }}
      />
      {others.map((o) => (
        <Marker key={o.id} position={[o.lat, o.lng]} icon={probeIcon(o.id.split("-").at(-1) ?? "", false)} interactive={false}>
          <Tooltip permanent direction="right" offset={[10, 0]}>
            {o.id}
          </Tooltip>
        </Marker>
      ))}
      <Marker
        position={[position.lat, position.lng]}
        icon={probeIcon("", true)}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ lat: ll.lat, lng: ll.lng });
          },
        }}
      >
        <Tooltip permanent direction="right" offset={[12, 0]}>
          {label}
        </Tooltip>
      </Marker>
      <ClickHandler onClick={(lat, lng) => onChange({ lat, lng })} />
    </MapContainer>
  );
}
