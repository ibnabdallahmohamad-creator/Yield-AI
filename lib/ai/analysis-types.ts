/** What GET/POST /api/analysis returns (client-safe). */
import type { ModelInput, ModelOutput } from "../dataset/schema";

export type AnalysisSource = "model" | "engine";

export interface FarmAnalysisResult {
  farm_id: string;
  farm_name: string;
  question: string;
  /** model: the fine-tuned Harvestar AI model answered. engine: the built-in engine, same format. */
  source: AnalysisSource;
  model: string;
  /** AI_MODEL_URL is set on the server. */
  model_configured: boolean;
  /** Why the model's answer isn't shown (unreachable, timed out, wrong format…). */
  model_error: string | null;
  /** Exactly what was (or would be) sent to the model. */
  input: ModelInput;
  output: ModelOutput;
  /** Assumptions made while building the input. */
  notes: string[];
  created_at: string;
  /** Model latency, ms. */
  ms: number | null;
}

export const ENGINE_MODEL_NAME = "harvestar-engine";
