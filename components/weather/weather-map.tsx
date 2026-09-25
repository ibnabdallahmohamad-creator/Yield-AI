"use client";

/**
 * Regional forecast map: the grid forecast for one hour drawn as a smooth raster (bilinear
 * between grid points), optional wind arrows, and the farms on top. Hovering shows the value
 * under the cursor. Leaflet touches `window`, so this loads through next/dynamic (index.tsx).
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { toLatLngRing, type GeoPolygon } from "@/lib/geo";
import { colorRgb } from "@/lib/metrics";
import { compass, sampleGrid } from "@/lib/weather/analysis";
import { formatWeatherValue, type WeatherLayer } from "@/lib/weather/layers";
import type { GridForecast } from "@/lib/weather/types";

export interface WeatherMapFarm {
  id: string;
  name: string;
  polygon: GeoPolygon;
  lat: number;
  lng: number;
  /** This farm's own forecast value for the hour (more exact than the grid). */
  value: number | null;
}

const TILE_CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
/** Raster pixels per grid step: smooth enough, cheap to repaint when the hour changes. */
const PX_PER_STEP = 24;

function gridBounds(grid: GridForecast): L.LatLngBounds {
  return L.latLngBounds([grid.lats[grid.lats.length - 1], grid.lngs[0]], [grid.lats[0], grid.lngs[grid.lngs.length - 1]]);
}

function paint(canvas: HTMLCanvasElement, grid: GridForecast, layer: WeatherLayer, hour: number) {
  const rows = grid.lats.length;
  const cols = grid.lngs.length;
  const w = (cols - 1) * PX_PER_STEP;
  const h = (rows - 1) * PX_PER_STEP;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  const north = grid.lats[0];
  const south = grid.lats[rows - 1];
  const west = grid.lngs[0];
  const east = grid.lngs[cols - 1];
  for (let y = 0; y < h; y++) {
    const lat = north - ((y + 0.5) / h) * (north - south);
    for (let x = 0; x < w; x++) {
      const lng = west + ((x + 0.5) / w) * (east - west);
      const v = sampleGrid(grid, layer.field, hour, lat, lng);
      if (v == null || (layer.transparentBelow != null && v < layer.transparentBelow)) continue;
      const [r, g, b] = colorRgb(layer, v);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function GridRaster({ grid, layer, hour, opacity }: { grid: GridForecast; layer: WeatherLayer; hour: number; opacity: number }) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundsKey = `${grid.lats[0]},${grid.lngs[0]},${grid.lats.at(-1)},${grid.lngs.at(-1)}`;

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvasRef.current = canvas;
    // L.svgOverlay only positions and sizes the element it is given, so a canvas works as well.
    const overlay = L.svgOverlay(canvas as unknown as SVGElement, gridBounds(grid), {
      interactive: false,
      opacity,
      className: "yai-raster",
    });
    overlay.addTo(map);
    overlay.bringToBack();
    return () => {
      overlay.remove();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only when the grid's extent changes
  }, [map, boundsKey, opacity]);

  useEffect(() => {
    if (canvasRef.current) paint(canvasRef.current, grid, layer, hour);
  }, [grid, layer, hour, boundsKey, opacity]);
  return null;
}

/** An arrow pointing where the wind blows to, sized by speed. */
function arrowIcon(fromDeg: number, speed: number): L.DivIcon {
  const size = Math.round(12 + Math.min(10, speed));
  const to = (fromDeg + 180) % 360;
  return L.divIcon({
    className: "yai-divicon",
    html: `<svg class="yai-wind-arrow" width="${size}" height="${size}" viewBox="0 0 24 24" style="transform: rotate(${to}deg)"><path d="M12 2 L18 12 L13.5 11 L13.5 22 L10.5 22 L10.5 11 L6 12 Z"/></svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function WindArrows({ grid, hour }: { grid: GridForecast; hour: number }) {
  const arrows = useMemo(() => {
    const out: Array<{ key: string; lat: number; lng: number; dir: number; speed: number }> = [];
    const cols = grid.lngs.length;
    grid.lats.forEach((lat, r) =>
      grid.lngs.forEach((lng, c) => {
        const dir = grid.fields.windDirection[hour]?.[r * cols + c];
        const speed = grid.fields.windSpeed[hour]?.[r * cols + c];
        if (dir != null && speed != null) out.push({ key: `${r}-${c}`, lat, lng, dir, speed });
      }),
    );
    return out;
  }, [grid, hour]);
  return (
    <>
      {arrows.map((a) => (
        <Marker key={a.key} position={[a.lat, a.lng]} icon={arrowIcon(a.dir, a.speed)} interactive={false} keyboard={false}>
          <Tooltip>
            {a.speed.toFixed(1)} m/s from {compass(a.dir)}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

function Readout({ grid, layer, hour, onValue }: { grid: GridForecast; layer: WeatherLayer; hour: number; onValue: (v: string | null) => void }) {
  useMapEvents({
    mousemove: (e) => {
      const v = sampleGrid(grid, layer.field, hour, e.latlng.lat, e.latlng.lng);
      onValue(v == null ? null : formatWeatherValue(layer, v));
    },
    mouseout: () => onValue(null),
  });
  return null;
}

export default function WeatherMap({
  grid,
  layer,
  hour,
  farms,
  selectedId,
  onSelect,
  showArrows = false,
}: {
  grid: GridForecast;
  layer: WeatherLayer;
  hour: number;
  farms: WeatherMapFarm[];
  selectedId: string | null;
  onSelect?: (id: string) => void;
  showArrows?: boolean;
}) {
  const bounds = useMemo(() => gridBounds(grid), [grid]);
  const [readout, setReadout] = useState<string | null>(null);
  return (
    <div className="relative size-full">
      <MapContainer bounds={bounds} maxZoom={16} minZoom={6} className="size-full" scrollWheelZoom attributionControl>
        <TileLayer
          url={TILE_CARTO_LIGHT}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Forecast: <a href="https://open-meteo.com">Open-Meteo</a>'
          subdomains="abcd"
          maxZoom={19}
        />
        <GridRaster grid={grid} layer={layer} hour={hour} opacity={0.72} />
        {showArrows ? <WindArrows grid={grid} hour={hour} /> : null}
        {farms.map((f) => (
          <Polygon
            key={`poly-${f.id}`}
            positions={toLatLngRing(f.polygon)}
            interactive={false}
            pathOptions={{ color: "#0b1f16", weight: f.id === selectedId ? 2.5 : 1.25, fill: false }}
          />
        ))}
        {farms.map((f) => (
          <CircleMarker
            key={`pin-${f.id}`}
            center={[f.lat, f.lng]}
            radius={f.id === selectedId ? 7 : 5}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: f.id === selectedId ? "#0b1f16" : "#1f5a3d", fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect?.(f.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]} permanent={f.id === selectedId} className="yai-hover">
              <span className="font-semibold">{f.name}</span>
              <span className="tabular"> · {formatWeatherValue(layer, f.value)}</span>
            </Tooltip>
          </CircleMarker>
        ))}
        <Readout grid={grid} layer={layer} hour={hour} onValue={setReadout} />
      </MapContainer>
      {readout ? (
        <span className="pointer-events-none absolute top-3 right-3 z-[1000] rounded-full bg-card/95 px-3 py-1 text-[12px] font-semibold shadow-md tabular">
          {layer.short} here: {readout}
        </span>
      ) : null}
    </div>
  );
}
