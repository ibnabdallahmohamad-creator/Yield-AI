/**
 * Farms and sensors that users create. Each account starts empty and only sees its own farms;
 * the built-in demo farms belong to the demo account (see `scope.ts`).
 *
 * Two backends:
 *  - Supabase (`farms.owner_id` + `sensors`, migration 0002) when Supabase is configured with the
 *    service-role key and USE_MOCK is off;
 *  - a local JSON file (`.data/farms.json`, git-ignored) otherwise, falling back to the OS temp
 *    directory and then to memory on read-only file systems.
 */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import { createSupabaseAdminClient, withTimeout } from "../supabase/server";
import { parseFarmRow } from "../data/supabase-source";
import type { Farm, Sensor } from "../types";

export interface StoredFarm extends Farm {
  owner_id: string;
  created_at: string;
}

export interface StoredSensor extends Sensor {
  farm_id: string;
  label: string;
  created_at: string;
}

export interface FarmStore {
  kind: "local" | "supabase";
  /** Bumped on every write (local backend) so caches keyed on it refresh. */
  version(): number;
  listFarms(ownerId: string): Promise<StoredFarm[]>;
  /** A farm by id, whoever owns it (for probe ingest). */
  findFarm(farmId: string): Promise<StoredFarm | null>;
  listSensors(farmIds: string[]): Promise<StoredSensor[]>;
  sensorExists(sensorId: string): Promise<boolean>;
  farmIdExists(farmId: string): Promise<boolean>;
  insertFarm(farm: StoredFarm): Promise<void>;
  deleteFarm(ownerId: string, farmId: string): Promise<boolean>;
  insertSensor(sensor: StoredSensor): Promise<void>;
  deleteSensor(farmId: string, sensorId: string): Promise<boolean>;
}

export class FarmStoreError extends Error {}

// ---------------------------------------------------------------------------
// Local JSON backend
// ---------------------------------------------------------------------------

interface LocalData {
  farms: StoredFarm[];
  sensors: StoredSensor[];
}

// Runtime data, not source: the fs calls below opt out of build-time file tracing.
const CANDIDATE_FILES = [path.join(process.cwd(), ".data", "farms.json"), path.join(tmpdir(), "yield-ai", "farms.json")];

const localState = globalThis as unknown as {
  __yieldFarmStore?: { data: LocalData; file: string | null; version: number; loaded: Promise<void> | null };
};

function state() {
  localState.__yieldFarmStore ??= { data: { farms: [], sensors: [] }, file: null, version: 0, loaded: null };
  return localState.__yieldFarmStore;
}

async function loadLocal(): Promise<LocalData> {
  const s = state();
  s.loaded ??= (async () => {
    for (const file of CANDIDATE_FILES) {
      try {
        const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as Partial<LocalData>;
        s.data = { farms: Array.isArray(parsed.farms) ? parsed.farms : [], sensors: Array.isArray(parsed.sensors) ? parsed.sensors : [] };
        s.file = file;
        return;
      } catch {
        // Try the next location.
      }
    }
  })();
  await s.loaded;
  return s.data;
}

async function persistLocal(): Promise<void> {
  const s = state();
  s.version++;
  const body = JSON.stringify(s.data, null, 2);
  const files = s.file ? [s.file, ...CANDIDATE_FILES.filter((f) => f !== s.file)] : CANDIDATE_FILES;
  for (const file of files) {
    try {
      await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ file, body, "utf8");
      s.file = file;
      return;
    } catch {
      // Read-only location — try the next one.
    }
  }
  console.warn("[farms] Could not persist farms to disk (kept in memory only). Configure Supabase for durable storage.");
}

const localStore: FarmStore = {
  kind: "local",
  version: () => state().version,
  async listFarms(ownerId) {
    const data = await loadLocal();
    return data.farms.filter((f) => f.owner_id === ownerId).sort((a, b) => a.name.localeCompare(b.name));
  },
  async findFarm(farmId) {
    return (await loadLocal()).farms.find((f) => f.id === farmId) ?? null;
  },
  async listSensors(farmIds) {
    const ids = new Set(farmIds);
    return (await loadLocal()).sensors.filter((s) => ids.has(s.farm_id)).sort((a, b) => a.id.localeCompare(b.id));
  },
  async sensorExists(sensorId) {
    return (await loadLocal()).sensors.some((s) => s.id.toLowerCase() === sensorId.toLowerCase());
  },
  async farmIdExists(farmId) {
    return (await loadLocal()).farms.some((f) => f.id === farmId);
  },
  async insertFarm(farm) {
    const data = await loadLocal();
    data.farms.push(farm);
    await persistLocal();
  },
  async deleteFarm(ownerId, farmId) {
    const data = await loadLocal();
    const before = data.farms.length;
    data.farms = data.farms.filter((f) => !(f.id === farmId && f.owner_id === ownerId));
    if (data.farms.length === before) return false;
    data.sensors = data.sensors.filter((s) => s.farm_id !== farmId);
    await persistLocal();
    return true;
  },
  async insertSensor(sensor) {
    const data = await loadLocal();
    data.sensors.push(sensor);
    await persistLocal();
  },
  async deleteSensor(farmId, sensorId) {
    const data = await loadLocal();
    const before = data.sensors.length;
    data.sensors = data.sensors.filter((s) => !(s.farm_id === farmId && s.id === sensorId));
    if (data.sensors.length === before) return false;
    await persistLocal();
    return true;
  },
};

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 8000;

function fail(what: string, error: { message: string; code?: string } | null): never {
  const hint = error?.code === "42703" || error?.code === "42P01" ? " — apply supabase/migrations/0002_user_farms.sql" : "";
  throw new FarmStoreError(`${what}: ${error?.message ?? "unknown error"}${hint}`);
}

function toStoredFarm(row: Record<string, unknown>): StoredFarm | null {
  const farm = parseFarmRow(row);
  if (!farm) return null;
  return { ...farm, owner_id: String(row.owner_id ?? ""), created_at: String(row.created_at ?? new Date(0).toISOString()) };
}

function toStoredSensor(row: Record<string, unknown>): StoredSensor {
  return {
    id: String(row.id),
    farm_id: String(row.farm_id),
    label: String(row.label ?? ""),
    lat: Number(row.lat),
    lng: Number(row.lng),
    created_at: String(row.created_at ?? ""),
  };
}

function supabaseStore(client: SupabaseClient): FarmStore {
  const run = <T>(p: PromiseLike<T>, label: string) => withTimeout(p, TIMEOUT_MS, label);
  return {
    kind: "supabase",
    version: () => 0,
    async listFarms(ownerId) {
      const { data, error } = await run(client.from("farms").select("*").eq("owner_id", ownerId).order("name"), "list farms");
      if (error) fail("farms", error);
      return (data ?? []).map((r) => toStoredFarm(r as Record<string, unknown>)).filter((f): f is StoredFarm => f !== null);
    },
    async findFarm(farmId) {
      const { data, error } = await run(client.from("farms").select("*").eq("id", farmId).not("owner_id", "is", null).maybeSingle(), "find farm");
      if (error) fail("farms", error);
      return data ? toStoredFarm(data as Record<string, unknown>) : null;
    },
    async listSensors(farmIds) {
      if (farmIds.length === 0) return [];
      const { data, error } = await run(client.from("sensors").select("*").in("farm_id", farmIds).order("id"), "list sensors");
      if (error) fail("sensors", error);
      return (data ?? []).map((r) => toStoredSensor(r as Record<string, unknown>));
    },
    async sensorExists(sensorId) {
      const [registered, readings] = await Promise.all([
        // Case-insensitive exact match: escape LIKE wildcards (`_` is allowed in sensor ids).
        run(client.from("sensors").select("id").ilike("id", sensorId.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1), "sensor exists"),
        run(client.from("sensor_readings").select("id").eq("sensor_id", sensorId).limit(1), "sensor readings"),
      ]);
      if (registered.error) fail("sensors", registered.error);
      return (registered.data?.length ?? 0) > 0 || (readings.data?.length ?? 0) > 0;
    },
    async farmIdExists(farmId) {
      const { data, error } = await run(client.from("farms").select("id").eq("id", farmId).limit(1), "farm exists");
      if (error) fail("farms", error);
      return (data?.length ?? 0) > 0;
    },
    async insertFarm(farm) {
      const { error } = await run(client.from("farms").insert(farm), "insert farm");
      if (error) fail("insert farm", error);
    },
    async deleteFarm(ownerId, farmId) {
      const { data, error } = await run(client.from("farms").delete().eq("id", farmId).eq("owner_id", ownerId).select("id"), "delete farm");
      if (error) fail("delete farm", error);
      return (data?.length ?? 0) > 0;
    },
    async insertSensor(sensor) {
      const { error } = await run(client.from("sensors").insert(sensor), "insert sensor");
      if (error) fail("insert sensor", error);
    },
    async deleteSensor(farmId, sensorId) {
      const { data, error } = await run(client.from("sensors").delete().eq("farm_id", farmId).eq("id", sensorId).select("id"), "delete sensor");
      if (error) fail("delete sensor", error);
      return (data?.length ?? 0) > 0;
    },
  };
}

/** The farm store for this deployment. */
export function farmStore(): FarmStore {
  if (!env.useMock) {
    const admin = createSupabaseAdminClient();
    if (admin) return supabaseStore(admin);
  }
  return localStore;
}
