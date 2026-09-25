/**
 * What the "Add farm" / "Add ESP32" forms send, validated the same way in the browser and in the
 * server actions (app/dashboard/actions.ts).
 */
import { z } from "zod";
import { CROP_IDS, type CropId } from "./agronomy-tables";
import {
  polygonArea_ha,
  polygonCentroid,
  polygonFromVertices,
  pointInPolygon,
  distanceToBoundary_m,
  ringSelfIntersects,
  type GeoPolygon,
  type LngLat,
} from "./geo";
import type { Farm } from "./types";

export const MIN_FARM_AREA_HA = 0.01;
export const MAX_FARM_AREA_HA = 10_000;
/** Probes may sit this far outside the drawn boundary (GPS and drawing are approximate). */
export const PROBE_BOUNDARY_TOLERANCE_M = 100;

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const FarmInputSchema = z.object({
  name: z.string().trim().min(2, { error: "Name the farm (at least 2 characters)." }).max(80),
  main_crop: z.enum(CROP_IDS as [CropId, ...CropId[]], { error: "Pick the main crop." }),
  planting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the planting date." }),
  soil_type: z.enum(["sand", "loamy_sand"]),
  region: z.string().trim().max(60).default(""),
  irrigation_water_ec: z.number({ error: "Enter the irrigation water EC." }).min(0).max(20),
  ec_calibration_factor: z.number({ error: "Enter the calibration factor." }).min(0.5).max(10),
  elevation_m: z.number().min(-450).max(5000),
  /** Field outline, [lng, lat] vertices in drawing order (not closed). */
  boundary: z.array(lngLat).min(3, { error: "Outline the field on the map (at least 3 corners)." }).max(300),
});
export type FarmInput = z.infer<typeof FarmInputSchema>;

export type FarmFieldErrors = Partial<Record<keyof FarmInput, string>>;

export interface FarmGeometry {
  polygon: GeoPolygon;
  area_ha: number;
  lat: number;
  lng: number;
}

/** Polygon, area and centre from the drawn outline, or an error message. */
export function farmGeometry(boundary: LngLat[]): { ok: true; geometry: FarmGeometry } | { ok: false; error: string } {
  if (boundary.length < 3) return { ok: false, error: "Outline the field on the map (at least 3 corners)." };
  const polygon = polygonFromVertices(boundary);
  if (ringSelfIntersects(polygon)) return { ok: false, error: "The outline crosses itself — undo the last corners and redraw." };
  const area = polygonArea_ha(polygon);
  if (area < MIN_FARM_AREA_HA) return { ok: false, error: "The field is too small — draw its full outline." };
  if (area > MAX_FARM_AREA_HA) return { ok: false, error: "The field is larger than 10,000 ha — draw one farm at a time." };
  const [lng, lat] = polygonCentroid(polygon);
  return { ok: true, geometry: { polygon, area_ha: Math.round(area * 100) / 100, lat, lng } };
}

export function validateFarmInput(input: unknown): { ok: true; value: FarmInput; geometry: FarmGeometry } | { ok: false; fieldErrors: FarmFieldErrors } {
  const parsed = FarmInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: FarmFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FarmInput | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const geometry = farmGeometry(parsed.data.boundary as LngLat[]);
  if (!geometry.ok) return { ok: false, fieldErrors: { boundary: geometry.error } };
  return { ok: true, value: parsed.data, geometry: geometry.geometry };
}

export const DeviceInputSchema = z.object({
  farm_id: z.string().min(1).max(80),
  name: z.string().trim().min(1, { error: "Name the device, e.g. “North probe”." }).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type DeviceInput = z.infer<typeof DeviceInputSchema>;

/** Is the probe position inside the field (or within a GPS-sized margin of it)? */
export function probeInsideFarm(farm: Pick<Farm, "polygon">, lat: number, lng: number): boolean {
  return pointInPolygon(lng, lat, farm.polygon) || distanceToBoundary_m(lng, lat, farm.polygon) <= PROBE_BOUNDARY_TOLERANCE_M;
}

/** URL-friendly farm id: "Al Khor Farm" → "al-khor-farm-3f9a". */
export function farmIdFor(name: string, suffix: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "farm"}-${suffix}`;
}
