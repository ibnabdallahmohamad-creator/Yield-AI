import "server-only";
import type { AssistantBoot, AssistantFarm } from "@/components/assistant/types";
import { CROPS } from "@/lib/agronomy-tables";
import { starterPrompts } from "@/lib/assistant";
import type { AppUser } from "@/lib/auth/session";
import { getChatStore, type ConversationWithMessages } from "@/lib/chat/store";
import { plainHeadline, rankFarms, riskReason } from "@/lib/dashboard";
import { getDashboardFor } from "@/lib/data/repository";
import { qatarDay } from "@/lib/format";

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Data for the assistant pages: small farm summaries, the date axis and the saved chats. */
export async function loadAssistant(
  user: AppUser,
  params: { farm?: unknown; q?: unknown; insight?: unknown; conversationId?: string },
): Promise<AssistantBoot> {
  const store = getChatStore(user);
  const [data, list, thread] = await Promise.all([
    getDashboardFor(user),
    store.list().catch((error: unknown) => {
      console.warn("[assistant] Could not load the chat history:", error instanceof Error ? error.message : error);
      return null;
    }),
    params.conversationId
      ? store.get(params.conversationId).then(
          (found): ConversationWithMessages | "not-found" => found ?? "not-found",
          (error: unknown) => {
            console.warn("[assistant] Could not load the chat:", error instanceof Error ? error.message : error);
            return "unavailable" as const;
          },
        )
      : Promise.resolve(null),
  ]);

  const farms: AssistantFarm[] = rankFarms(data.farms).map((b) => {
    const reason = riskReason(b);
    return {
      id: b.farm.id,
      name: b.farm.name,
      crop: CROPS[b.farm.main_crop].name,
      riskLevel: b.insight?.risk_level ?? null,
      reason: reason.label,
      reasonTone: reason.tone,
      headline: plainHeadline(b),
      prompts: starterPrompts(b),
      hasReadings: b.days.some(Boolean),
    };
  });

  const known = (id: unknown) => (typeof id === "string" && farms.some((f) => f.id === id) ? id : null);
  const conversation = thread && typeof thread === "object" ? thread : null;

  return {
    farms,
    dates: data.dates,
    today: qatarDay(new Date().toISOString()),
    user: { name: user.name, email: user.email },
    initialFarmId: known(conversation?.conversation.farm_id) ?? known(params.farm),
    conversationId: params.conversationId ?? null,
    conversation,
    conversationError: thread === "not-found" || thread === "unavailable" ? thread : null,
    list,
    question: text(params.q, 1000),
    insightId: text(params.insight, 128),
  };
}
