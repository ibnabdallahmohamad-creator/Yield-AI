/**
 * Trimmed demo data for the public landing page widgets: every farm's pin and headline insight,
 * one farm's last 30 days for the chart, and pre-computed answers for the chat chips. Built from
 * the built-in demo dataset only (see getDemoDashboard).
 */
import "server-only";
import { CROPS } from "../agronomy-tables";
import { lastDataIndex } from "../ai/analysis";
import { buildChatContext } from "../ai/context";
import type { Priority, RiskLevel } from "../ai/contract";
import { answerOffline } from "../ai/offline";
import { farmValueAt, probeSamples, rankFarms, suggestedQuestions, type ProbeSample } from "../dashboard";
import type { GeoPolygon } from "../geo";
import { METRICS } from "../metrics";
import type { FarmBundle } from "../types";
import { getDemoDashboard } from "./repository";

export const SHOWCASE_CHART_DAYS = 30;

export interface ShowcaseFarm {
  id: string;
  name: string;
  crop: string;
  region: string;
  areaHa: number;
  polygon: GeoPolygon;
  /** Farm-mean ECe (dS/m) on its latest day. */
  ece: number | null;
  /** Per-probe ECe for the interpolated field layer. */
  samples: ProbeSample[];
  risk: { level: RiskLevel; score: number } | null;
  summary: string | null;
  action: { title: string; priority: Priority } | null;
}

export interface ShowcaseAnswer {
  question: string;
  answer: string;
}

export interface Showcase {
  farms: ShowcaseFarm[];
  /** The riskiest farm's last 30 days (chart and chat subject). */
  chart: { bundle: FarmBundle; dates: string[] };
  chat: { farmName: string; answers: ShowcaseAnswer[] };
}

export async function getShowcase(): Promise<Showcase> {
  const data = await getDemoDashboard();
  const ranked = rankFarms(data.farms);

  const farms: ShowcaseFarm[] = ranked.map((b) => {
    const index = lastDataIndex(b);
    const top = b.insight?.recommendations[0];
    return {
      id: b.farm.id,
      name: b.farm.name,
      crop: CROPS[b.farm.main_crop].name,
      region: b.farm.region,
      areaHa: b.farm.area_ha,
      polygon: b.farm.polygon,
      ece: farmValueAt(b, METRICS.ece, index),
      samples: probeSamples(b, METRICS.ece, index),
      risk: b.insight ? { level: b.insight.risk_level, score: Math.round(b.insight.risk_score) } : null,
      summary: b.insight?.summary ?? null,
      action: top ? { title: top.title, priority: top.priority } : null,
    };
  });

  const subject = ranked[0];
  const start = Math.max(0, data.dates.length - SHOWCASE_CHART_DAYS);
  const bundle: FarmBundle = { ...subject, days: subject.days.slice(start), insight: null };
  const dates = data.dates.slice(start);

  const context = buildChatContext(subject, data);
  const questions = suggestedQuestions(subject.days[lastDataIndex(subject)] ?? null);
  const answers = context ? questions.map((question) => ({ question, answer: answerOffline(question, context) })) : [];

  return { farms, chart: { bundle, dates }, chat: { farmName: subject.farm.name, answers } };
}
