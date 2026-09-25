"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CROP_IDS, type CropId } from "@/lib/agronomy-tables";
import { getCurrentUser, type AppUser } from "@/lib/auth/session";
import { invalidateDashboardCache } from "@/lib/data/repository";
import { isDemoUser, scopeFor, type DataScope } from "@/lib/farms/scope";
import {
  fieldSummary,
  nextSensorId,
  polygonFromPoints,
  SENSOR_ID_PATTERN,
  sensorPrefix,
  slugify,
  squareFieldAround,
} from "@/lib/farms/shapes";
import { farmStore, FarmStoreError, type StoredFarm } from "@/lib/farms/store";
import { haversineKm, inQatarBbox } from "@/lib/land/grid";
import { landCellAt } from "@/lib/land/profile";
import type { LngLat } from "@/lib/geo";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const DEMO_READ_ONLY = "The demo account is read-only. Create your own free account to add farms and sensors.";

type Owner = { user: AppUser; scope: DataScope };

async function requireOwner(): Promise<Owner | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  if (isDemoUser(user)) return { error: DEMO_READ_ONLY };
  return { user, scope: scopeFor(user) };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function storeError(error: unknown): string {
  if (error instanceof FarmStoreError) return `Could not save: ${error.message}`;
  console.error("[farms] store error:", error);
  return "Something went wrong while saving. Please try again.";
}

const Coordinate = z.number({ error: "Enter a number." }).refine(Number.isFinite, { error: "Enter a number." });

const CreateFarmSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Give the farm a name (at least 2 characters)." }).max(80),
    lat: Coordinate,
    lng: Coordinate,
    areaHa: z.number().min(0.05, { error: "Area must be at least 0.05 ha." }).max(5000, { error: "Area must be at most 5,000 ha." }),
    boundary: z.array(z.tuple([z.number(), z.number()])).max(300).optional(),
    mainCrop: z.enum(CROP_IDS as [CropId, ...CropId[]], { error: "Choose the main crop." }),
    plantingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick the planting date." }),
    soilType: z.enum(["sand", "loamy_sand"]).optional(),
    irrigationWaterEc: z.number().min(0).max(30, { error: "ECw must be between 0 and 30 dS/m." }).optional(),
    elevationM: z.number().min(-10).max(150).optional(),
  })
  .refine((v) => inQatarBbox(v.lat, v.lng), { error: "Drop the pin on a location in Qatar.", path: ["lat"] });

export type CreateFarmInput = z.input<typeof CreateFarmSchema>;

export async function createFarmAction(input: CreateFarmInput): Promise<ActionResult<{ farmId: string }>> {
  const auth = await requireOwner();
  if ("error" in auth) return { ok: false, error: auth.error };
  const parsed = CreateFarmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;

  const cell = landCellAt(v.lat, v.lng);
  if (!cell) return { ok: false, error: "That point is not on land in Qatar — move the pin onto the farm.", fieldErrors: { lat: "Not on land in Qatar." } };

  const drawn = v.boundary ? polygonFromPoints(v.boundary as LngLat[]) : null;
  if (v.boundary && v.boundary.length > 0 && !drawn) {
    return { ok: false, error: "The field outline needs at least 3 corners.", fieldErrors: { boundary: "Add at least 3 corners, or clear the outline." } };
  }
  const polygon = drawn ?? squareFieldAround(v.lat, v.lng, v.areaHa);
  const field = fieldSummary(polygon);
  if (haversineKm(field.lat, field.lng, v.lat, v.lng) > 5) {
    return { ok: false, error: "The outline is far from the pin — redraw it around the farm.", fieldErrors: { boundary: "Too far from the pin." } };
  }

  const store = farmStore();
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  try {
    let id = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      id = `${slugify(v.name, 40)}-${randomBytes(3).toString("hex")}`;
      if (!(await store.farmIdExists(id))) break;
    }
    const farm: StoredFarm = {
      id,
      name: v.name,
      owner: auth.user.name,
      owner_id: auth.user.id,
      lat: round(field.lat, 6),
      lng: round(field.lng, 6),
      area_ha: round(field.areaHa, 2),
      main_crop: v.mainCrop,
      polygon,
      region: cell.municipality,
      planting_date: v.plantingDate,
      soil_type: v.soilType ?? cell.landscape.soil.farmSoilType,
      theta_fc: null,
      theta_wp: null,
      elevation_m: v.elevationM ?? 15,
      ec_calibration_factor: 3.0,
      irrigation_water_ec: v.irrigationWaterEc ?? cell.landscape.groundwater.ecw_dS_m,
      created_at: new Date().toISOString(),
    };
    await store.insertFarm(farm);
    invalidateDashboardCache(auth.scope);
    revalidatePath("/dashboard");
    return { ok: true, farmId: id };
  } catch (error) {
    return { ok: false, error: storeError(error) };
  }
}

async function ownedFarm(ownerId: string, farmId: string): Promise<StoredFarm | null> {
  const farms = await farmStore().listFarms(ownerId);
  return farms.find((f) => f.id === farmId) ?? null;
}

export async function deleteFarmAction(farmId: string): Promise<ActionResult> {
  const auth = await requireOwner();
  if ("error" in auth) return { ok: false, error: auth.error };
  try {
    const removed = await farmStore().deleteFarm(auth.user.id, String(farmId));
    if (!removed) return { ok: false, error: "That farm doesn't exist or isn't yours." };
    invalidateDashboardCache(auth.scope);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: storeError(error) };
  }
}

/** Probes must sit on or near the farm: within this distance of the field centre. */
const MAX_SENSOR_DISTANCE_KM = 3;

const AddSensorSchema = z.object({
  farmId: z.string().min(1).max(64),
  sensorId: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === "" || SENSOR_ID_PATTERN.test(v), { error: "2–32 letters, digits, dots, dashes or underscores." })
    .optional(),
  label: z.string().trim().max(60).optional(),
  lat: Coordinate.min(-90).max(90),
  lng: Coordinate.min(-180).max(180),
});

export type AddSensorInput = z.input<typeof AddSensorSchema>;

export async function addSensorAction(input: AddSensorInput): Promise<ActionResult<{ sensorId: string }>> {
  const auth = await requireOwner();
  if ("error" in auth) return { ok: false, error: auth.error };
  const parsed = AddSensorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  const store = farmStore();
  try {
    const farm = await ownedFarm(auth.user.id, v.farmId);
    if (!farm) return { ok: false, error: "That farm doesn't exist or isn't yours." };
    const distance = haversineKm(v.lat, v.lng, farm.lat, farm.lng);
    if (distance > MAX_SENSOR_DISTANCE_KM) {
      return {
        ok: false,
        error: `That point is ${distance.toFixed(1)} km from ${farm.name}. Place the sensor on the farm.`,
        fieldErrors: { lat: "Too far from the farm." },
      };
    }
    const existing = await store.listSensors([farm.id]);
    let sensorId = v.sensorId ?? "";
    if (sensorId) {
      if (await store.sensorExists(sensorId)) {
        return { ok: false, error: "That sensor ID is already in use.", fieldErrors: { sensorId: "Already in use — pick another ID." } };
      }
    } else {
      const prefix = `${sensorPrefix(farm.name)}-${farm.id.slice(-4).toUpperCase()}`;
      const taken = existing.map((s) => s.id);
      sensorId = nextSensorId(prefix, taken);
      while (await store.sensorExists(sensorId)) {
        taken.push(sensorId);
        sensorId = nextSensorId(prefix, taken);
      }
    }
    await store.insertSensor({
      id: sensorId,
      farm_id: farm.id,
      label: v.label ?? "",
      lat: Math.round(v.lat * 1e6) / 1e6,
      lng: Math.round(v.lng * 1e6) / 1e6,
      created_at: new Date().toISOString(),
    });
    invalidateDashboardCache(auth.scope);
    revalidatePath(`/dashboard/farm/${farm.id}`);
    return { ok: true, sensorId };
  } catch (error) {
    return { ok: false, error: storeError(error) };
  }
}

export async function deleteSensorAction(farmId: string, sensorId: string): Promise<ActionResult> {
  const auth = await requireOwner();
  if ("error" in auth) return { ok: false, error: auth.error };
  try {
    const farm = await ownedFarm(auth.user.id, String(farmId));
    if (!farm) return { ok: false, error: "That farm doesn't exist or isn't yours." };
    const removed = await farmStore().deleteSensor(farm.id, String(sensorId));
    if (!removed) return { ok: false, error: "That sensor was already removed." };
    invalidateDashboardCache(auth.scope);
    revalidatePath(`/dashboard/farm/${farm.id}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: storeError(error) };
  }
}
