/**
 * A farm's AI analysis: its ESP32 soil moisture and live weather → the fine-tuned model's input →
 * the model's answer (or the built-in engine's answer in the same format) → the page's sections.
 */
import "server-only";
import type { AppUser } from "../auth/session";
import { getAccountStore } from "../account/store";
import { getFarmBundleFor } from "../data/repository";
import type { FarmBundle } from "../types";
import { ENGINE_MODEL_NAME, type FarmAnalysisResult } from "./analysis-types";
import type { ProbeMoisture } from "./esp32-units";
import { askModel, modelConfigured } from "./model-client";
import { buildLiveFarmExample, defaultQuestion } from "./model-input";
import { probeWording } from "./probe-wording";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CACHE_MS = 10 * 60_000;

const g = globalThis as typeof globalThis & { __harvestarAnalyses?: Map<string, { at: number; promise: Promise<FarmAnalysisResult> }> };
const cache = (g.__harvestarAnalyses ??= new Map());

/** Hourly probe means for the last 8.5 days, from the account's stored ESP32 readings. */
async function accountMoisture(user: AppUser, farmId: string, now: number): Promise<ProbeMoisture[]> {
  const buckets = await getAccountStore(user).bucketSeries(farmId, now - 8.5 * DAY, now + 60_000, HOUR);
  const out: ProbeMoisture[] = [];
  for (const [sensor, byTime] of buckets) {
    for (const stats of byTime.values()) {
      const m = stats.moisture;
      if (!m || m.n === 0) continue;
      out.push({ sensor_id: sensor, timestamp: new Date(m.lastT ?? stats.lastT).toISOString(), moisture: m.sum / m.n });
    }
  }
  return out;
}

/** The demo farms keep daily means per probe: today's counts as the latest survey. */
function dailyMoisture(bundle: FarmBundle, dates: string[], now: number): ProbeMoisture[] {
  const out: ProbeMoisture[] = [];
  const last = dates.length - 1;
  bundle.days.forEach((day, i) => {
    if (!day || last - i > 9) return;
    const t = now - (last - i) * DAY - 30 * 60_000;
    for (const s of day.sensors) if (s.moisture != null) out.push({ sensor_id: s.id, timestamp: new Date(t).toISOString(), moisture: s.moisture });
  });
  return out;
}

async function run(user: AppUser, farmId: string, question: string | undefined): Promise<FarmAnalysisResult | null> {
  const found = await getFarmBundleFor(user, farmId);
  if (!found) return null;
  const { data, bundle } = found;
  const now = Date.now();
  const moisture = data.source === "account" ? await accountMoisture(user, farmId, now) : dailyMoisture(bundle, data.dates, now);
  const example = await buildLiveFarmExample({ farm: bundle.farm, moisture, question, now });

  const configured = modelConfigured();
  let modelError: string | null = null;
  if (configured) {
    try {
      const reply = await askModel(example.input);
      return {
        farm_id: farmId,
        farm_name: bundle.farm.name,
        question: example.input.question,
        source: "model",
        model: reply.model,
        model_configured: true,
        model_error: null,
        input: example.input,
        output: probeWording(reply.answer),
        notes: example.notes,
        created_at: new Date().toISOString(),
        ms: reply.ms,
      };
    } catch (error) {
      modelError = error instanceof Error ? error.message : String(error);
      console.warn("[analysis] Model failed, showing the built-in engine:", modelError);
    }
  }
  return {
    farm_id: farmId,
    farm_name: bundle.farm.name,
    question: example.input.question,
    source: "engine",
    model: ENGINE_MODEL_NAME,
    model_configured: configured,
    model_error: modelError,
    input: example.input,
    output: probeWording(example.engine),
    notes: example.notes,
    created_at: new Date().toISOString(),
    ms: null,
  };
}

/** The farm's analysis for a question (the default question's answer is cached for 10 minutes). Null when the farm isn't the user's. */
export async function analyzeFarm(user: AppUser, farmId: string, question?: string, fresh = false): Promise<FarmAnalysisResult | null> {
  const q = question?.trim();
  if (q) return run(user, farmId, q);
  const key = `${user.provider}:${user.id}:${farmId}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = run(user, farmId, undefined);
  cache.set(key, { at: Date.now(), promise });
  promise.then(
    (r) => {
      // Don't keep a failed model call (or a missing farm) for 10 minutes.
      if (!r || r.model_error) cache.delete(key);
    },
    () => cache.delete(key),
  );
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return promise;
}

export { defaultQuestion };
