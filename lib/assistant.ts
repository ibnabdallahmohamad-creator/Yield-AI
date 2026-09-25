/**
 * Client-safe helpers for the full-screen assistant (ui_improvement §5): the history sidebar's
 * groups, the empty-state prompts, follow-up suggestions and the "as of" labels.
 */
import type { Conversation } from "./ai/contract";
import { lastDataIndex } from "./ai/analysis";
import { sortedActions, suggestedQuestions } from "./dashboard";
import { addDays } from "./data/time";
import { formatShortDay, qatarDay } from "./format";
import type { FarmBundle } from "./types";

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

/**
 * Pinned chats first, then Today / Yesterday / Previous 7 days / Older by last activity
 * (Qatar days). `today` is passed in so the server and the browser group the same way.
 */
export function groupConversations(list: Conversation[], today: string): { pinned: Conversation[]; groups: ConversationGroup[] } {
  const byRecent = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const yesterday = addDays(today, -1);
  const weekAgo = addDays(today, -7);
  const buckets: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  const pinned: Conversation[] = [];
  for (const c of byRecent) {
    if (c.pinned) {
      pinned.push(c);
      continue;
    }
    const day = qatarDay(c.updated_at);
    const bucket = day >= today ? 0 : day === yesterday ? 1 : day >= weekAgo ? 2 : 3;
    buckets[bucket].items.push(c);
  }
  return { pinned, groups: buckets.filter((g) => g.items.length > 0) };
}

const TOPICS: Array<{ match: RegExp; followUps: string[] }> = [
  {
    match: /salin|salt|leach|\bece\b|\bec\b/i,
    followUps: ["How much extra water does leaching need?", "Which probe is the saltiest, and why?", "What happens to the yield if salinity keeps rising?"],
  },
  {
    match: /irrigat|water|dry|moist|deficit/i,
    followUps: ["How much water is that for the whole farm?", "When should I irrigate after that?", "Is the soil drying faster than last week?"],
  },
  {
    match: /plant|crop|season|grow next/i,
    followUps: ["What yield would that crop get at this salt level?", "What is the market like for it?", "What should I do to the soil before planting?"],
  },
  {
    match: /heat|hot|temperat/i,
    followUps: ["How can I protect the crop from the heat?", "Should I irrigate more on hot days?", "What is the forecast for the next week?"],
  },
  {
    match: /rain|forecast|weather/i,
    followUps: ["Does the forecast change my irrigation plan?", "How much water will the crop use this week?"],
  },
  {
    match: /nutrient|fertili|npk|nitrogen|phosph|potass|\bph\b/i,
    followUps: ["How much fertiliser should I apply?", "Does the soil pH limit nutrient uptake?", "Which nutrient is lowest?"],
  },
];

const GENERAL = ["What should I do first this week?", "Which probe needs attention?", "How much should I irrigate?"];

const norm = (q: string) => q.trim().toLowerCase().replace(/[?.!\s]+$/, "");

/**
 * Follow-up questions after an answer (ui_improvement C3): related to the last question and never
 * one that was already asked in this chat.
 */
export function followUps(lastQuestion: string, asked: string[], limit = 3): string[] {
  const seen = new Set(asked.map(norm));
  const topic = TOPICS.find((t) => t.match.test(lastQuestion));
  const pool = [...(topic?.followUps ?? []), ...GENERAL];
  const out: string[] = [];
  for (const q of pool) {
    if (out.length >= limit) break;
    if (!seen.has(norm(q)) && !out.includes(q)) out.push(q);
  }
  return out;
}

/** Four starter prompts for a farm: its suggested questions plus one about its top action. */
export function starterPrompts(bundle: FarmBundle): string[] {
  const day = bundle.days[lastDataIndex(bundle)] ?? null;
  const top = sortedActions(bundle.insight)[0];
  const prompts = [
    ...suggestedQuestions(day),
    top ? `Walk me through the first action: ${top.title}` : "What changed in the last 30 days?",
  ];
  return [...new Set(prompts)].slice(0, 4);
}

/** "Today", "Yesterday" or "23 Sep" for the "as of" picker. */
export function asOfLabel(date: string, latest: string): string {
  if (date === latest) return "Today";
  if (date === addDays(latest, -1)) return "Yesterday";
  return formatShortDay(date);
}
