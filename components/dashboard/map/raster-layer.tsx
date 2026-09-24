"use client";

/**
 * The "sensor heat layer": IDW-interpolated probe values (power 2, 5 m cells) drawn as a smooth
 * raster clipped to the field outline. The grid is painted into a <canvas> that Leaflet positions
 * over the field's bounds, so scrubbing the timeline repaints pixels instead of re-encoding images.
 */
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import type { GeoPolygon } from "@/lib/geo";
import { outerRing } from "@/lib/geo";
import { buildIdwGrid, type RasterGrid } from "@/lib/idw";
import { colorRgb, type MetricDef } from "@/lib/metrics";
import type { ProbeSample } from "@/lib/dashboard";

/** Canvas pixels per grid cell: the upscale that turns 5 m cells into a smooth field. */
const UPSCALE = 4;

function paint(canvas: HTMLCanvasElement, grid: RasterGrid, metric: MetricDef, polygon: GeoPolygon) {
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
  ctx.restore();
}

export function RasterLayer({
  polygon,
  samples,
  metric,
  uniformValue,
  opacity = 0.82,
}: {
  polygon: GeoPolygon;
  samples: ProbeSample[];
  metric: MetricDef;
  /** Non-spatial metrics (ET₀, ETc): one farm-level value fills the field. */
  uniformValue?: number | null;
  opacity?: number;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // Repaint whenever the values or the metric change.
  useEffect(() => {
    if (grid && canvasRef.current) paint(canvasRef.current, grid, metric, polygon);
  }, [grid, metric, polygon, boundsKey]);

  return null;
}
