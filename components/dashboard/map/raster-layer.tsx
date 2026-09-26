"use client";

/**
 * The "sensor heat layer": IDW-interpolated probe values (power 2, 5 m cells) drawn as a smooth
 * raster clipped to the field outline, with faint isolines at the class boundaries and a bold one
 * at the farm's limit (the crop's salinity threshold, the irrigation trigger). The grid is painted
 * into a <canvas> that Leaflet positions over the field's bounds, so scrubbing the timeline
 * repaints pixels instead of re-encoding images.
 */
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import type { GeoPolygon } from "@/lib/geo";
import { outerRing } from "@/lib/geo";
import { buildIdwGrid, type RasterGrid } from "@/lib/idw";
import { colorRgb, type MetricDef } from "@/lib/metrics";
import type { ProbeSample } from "@/lib/dashboard";
import { marchingSquares } from "@/lib/weather/contours";

/** The limit line on the field: white halo under the threshold red. */
const LIMIT_RED = "#c0262d";

/** Canvas pixels per grid cell: the upscale that turns 5 m cells into a smooth field. */
const UPSCALE = 4;

/** `scale`: canvas pixels per screen pixel, so the isolines keep one on-screen width at every zoom. */
function paint(canvas: HTMLCanvasElement, grid: RasterGrid, metric: MetricDef, polygon: GeoPolygon, limit: number | null, scale: number) {
  const w = grid.cols * UPSCALE;
  const h = grid.rows * UPSCALE;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 1. One pixel per cell, coloured with the metric's continuous scale.
  const small = document.createElement("canvas");
  small.width = grid.cols;
  small.height = grid.rows;
  const sctx = small.getContext("2d");
  if (!sctx) return;
  const img = sctx.createImageData(grid.cols, grid.rows);
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i];
    if (!Number.isFinite(v)) continue;
    const [r, g, b] = colorRgb(metric, v);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  // 2. Clip to the exact field outline, then upscale with smoothing.
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  outerRing(polygon).forEach(([lng, lat], i) => {
    const x = ((lng - grid.west) / (grid.east - grid.west)) * w;
    const y = ((grid.north - lat) / (grid.north - grid.south)) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, w, h);

  // 3. Isolines (still clipped): segments are in cell units, cell centres at +0.5.
  const inRange = (v: number) => v > grid.min && v < grid.max;
  const trace = (level: number) => {
    const [set] = marchingSquares(grid.values, grid.cols, grid.rows, [level]);
    const s = set?.segments ?? [];
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 4) {
      ctx.moveTo((s[i] + 0.5) * UPSCALE, (s[i + 1] + 0.5) * UPSCALE);
      ctx.lineTo((s[i + 2] + 0.5) * UPSCALE, (s[i + 3] + 0.5) * UPSCALE);
    }
    return s.length > 0;
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const c of metric.classes.slice(0, -1)) {
    if (!inRange(c.max) || (limit != null && Math.abs(c.max - limit) < 1e-6)) continue;
    if (!trace(c.max)) continue;
    ctx.strokeStyle = "rgba(20, 32, 26, 0.35)";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
  }
  if (limit != null && inRange(limit) && trace(limit)) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 4.5 * scale;
    ctx.stroke();
    ctx.strokeStyle = LIMIT_RED;
    ctx.lineWidth = 2.25 * scale;
    ctx.stroke();
  }
  ctx.restore();
}

export function RasterLayer({
  polygon,
  samples,
  metric,
  uniformValue,
  limit = null,
  opacity = 0.82,
}: {
  polygon: GeoPolygon;
  samples: ProbeSample[];
  metric: MetricDef;
  /** Non-spatial metrics (ET₀, ETc): one farm-level value fills the field. */
  uniformValue?: number | null;
  /** Draw this value's isoline in bold red (the crop's limit). */
  limit?: number | null;
  opacity?: number;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Leaflet stretches the canvas to the field's size on screen: repaint the lines after each zoom.
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  const grid = useMemo(() => {
    const pts =
      uniformValue != null
        ? [{ lng: polygon.coordinates[0][0][0], lat: polygon.coordinates[0][0][1], value: uniformValue }]
        : samples.map((s) => ({ lng: s.lng, lat: s.lat, value: s.value }));
    if (pts.length === 0) return null;
    return buildIdwGrid(polygon, pts, 5, 2, { clip: false });
  }, [polygon, samples, uniformValue]);

  const boundsKey = grid ? `${grid.west},${grid.north},${grid.east},${grid.south}` : "";

  // Create the overlay once per field geometry.
  useEffect(() => {
    if (!grid) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvasRef.current = canvas;
    const bounds = L.latLngBounds([grid.south, grid.west], [grid.north, grid.east]);
    // L.svgOverlay only positions and sizes the element it is given, so a canvas works as well.
    const layer = L.svgOverlay(canvas as unknown as SVGElement, bounds, {
      interactive: false,
      opacity,
      className: "yai-raster",
      pane: "overlayPane",
    });
    layer.addTo(map);
    layer.bringToBack();
    return () => {
      layer.remove();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only when the field's bounds change
  }, [map, boundsKey]);

  // Repaint whenever the values, the metric or the zoom change.
  useEffect(() => {
    if (!grid || !canvasRef.current) return;
    const west = map.latLngToContainerPoint([grid.north, grid.west]).x;
    const east = map.latLngToContainerPoint([grid.north, grid.east]).x;
    const scale = (grid.cols * UPSCALE) / Math.max(1, east - west);
    paint(canvasRef.current, grid, metric, polygon, limit, scale);
  }, [map, grid, metric, polygon, boundsKey, limit, zoom]);

  return null;
}
