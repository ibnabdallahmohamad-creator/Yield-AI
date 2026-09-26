import { NextResponse } from "next/server";
import { buildChatContext } from "@/lib/ai/context";
import {
  ChatRequestSchema,
  type ChatAnswerSource,
  type ChatResponse,
  type Conversation,
  type ConversationMessage,
} from "@/lib/ai/contract";
import { analyzeFarm } from "@/lib/ai/live-analysis";
import { askLlm, llmAvailable } from "@/lib/ai/llm";
import { modelConfigured } from "@/lib/ai/model-client";
import { answerOffline } from "@/lib/ai/offline";
import { aiServiceConfigured, askAiService } from "@/lib/ai/service";
import { getCurrentUser } from "@/lib/auth/session";
import { CONVERSATION_NOT_FOUND } from "@/lib/chat/api";
import {
  CHAT_LIMITS,
  getChatStore,
  titleFromQuestion,
  type ChatStore,
  type ConversationWithMessages,
  type NewMessage,
} from "@/lib/chat/store";
import { getFarmBundleFor } from "@/lib/data/repository";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : error);

/**
 * POST /api/chat — { farm_id, question, date?, history?, conversation_id?, new_conversation?,
 * insight_id?, regenerate? } → ChatResponse.
 * Answer chain: the fine-tuned Harvestar AI model (AI_MODEL_URL, its JSON answer is split into sections
 * by the chat) → the team's AI service → Claude (LLM fallback) → offline agronomy engine.
 * With `conversation_id` or `new_conversation` the exchange is saved and history comes from storage;
 * without them the chat is stateless. A storage failure never blocks the answer.
 */
/** The fine-tuned model may take up to ~55 s. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in to use the assistant." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = ChatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { farm_id, date, conversation_id, new_conversation, insight_id, regenerate } = parsed.data;
  let { question, history } = parsed.data;
  const askedAt = new Date().toISOString();

  // Saved conversation: load it first so an unknown (or someone else's) id fails fast.
  const store = conversation_id || new_conversation ? getChatStore(user) : null;
  let saving = Boolean(store);
  let thread: ConversationWithMessages | null = null;
  if (store && conversation_id) {
    try {
      thread = await store.get(conversation_id);
    } catch (error) {
      saving = false;
      console.warn("[chat] Could not load the conversation, answering without saving:", messageOf(error));
    }
    if (saving && !thread) return NextResponse.json({ error: CONVERSATION_NOT_FOUND }, { status: 404 });
  }

  // History comes from storage; regenerate answers the last stored question again.
  let replay: ConversationMessage | null = null;
  if (thread) {
    let prior = thread.messages;
    const lastQuestion = regenerate ? prior.findLastIndex((m) => m.role === "user") : -1;
    if (lastQuestion >= 0) {
      replay = prior[lastQuestion];
      question = replay.content;
      prior = prior.slice(0, lastQuestion);
    }
    history = prior.slice(-CHAT_LIMITS.historyTurns).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  }

  const found = await getFarmBundleFor(user, farm_id);
  if (!found) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
  const { data, bundle } = found;
  const dateIndex = date ? data.dates.indexOf(date) : -1;
  const context = buildChatContext(bundle, data, dateIndex >= 0 ? dateIndex : undefined);
  if (!context) {
    return NextResponse.json({ error: "There are no readings for this farm yet." }, { status: 409 });
  }

  let answer: string | null = null;
  let source: ChatAnswerSource = "offline";
  let model: string | null = null;

  if (modelConfigured()) {
    try {
      const res = await analyzeFarm(user, farm_id, question);
      if (res?.source === "model") {
        answer = JSON.stringify(res.output);
        source = "ai-service";
        model = res.model;
      }
    } catch (error) {
      console.warn("[chat] Harvestar AI model failed, falling back:", error instanceof Error ? error.message : error);
    }
  }
  if (!answer && aiServiceConfigured()) {
    try {
      const res = await askAiService({ farm_id, question, context, history });
      answer = res.answer;
      source = "ai-service";
      model = "harvestar-ai";
    } catch (error) {
      console.warn("[chat] AI service failed, falling back:", error instanceof Error ? error.message : error);
    }
  }
  if (!answer && llmAvailable()) {
    try {
      const res = await askLlm(question, context, history);
      if (res) {
        answer = res.answer;
        source = "llm";
        model = res.model;
      }
    } catch (error) {
      console.warn("[chat] LLM fallback failed, using the offline engine:", error instanceof Error ? error.message : error);
    }
  }
  if (!answer) {
    answer = answerOffline(question, context);
    source = "offline";
    model = "agronomy-rules";
  }

  const answeredAt = new Date().toISOString();
  const saved =
    store && saving
      ? await saveExchange(store, {
          thread,
          replay: Boolean(replay),
          farm_id,
          question,
          insight_id: insight_id ?? null,
          as_of: context.as_of,
          askedAt,
          answer,
          source,
          model,
          answeredAt,
        })
      : null;

  const body: ChatResponse = {
    farm_id,
    answer,
    source,
    model,
    created_at: saved?.message.created_at ?? answeredAt,
    conversation_id: saved?.conversation.id ?? null,
    ...saved,
  };
  return NextResponse.json(body);
}

interface Exchange {
  thread: ConversationWithMessages | null;
  /** Regenerating: the question is already stored. */
  replay: boolean;
  farm_id: string;
  question: string;
  insight_id: string | null;
  /** The day the context described. */
  as_of: string;
  askedAt: string;
  answer: string;
  source: ChatAnswerSource;
  model: string | null;
  answeredAt: string;
}

interface SavedExchange {
  conversation: Conversation;
  user_message?: ConversationMessage;
  message: ConversationMessage;
}

/** Store the question (unless regenerating) and the answer. Null when storage fails. */
async function saveExchange(store: ChatStore, x: Exchange): Promise<SavedExchange | null> {
  try {
    const id = x.thread?.conversation.id ?? (await store.create({ farm_id: x.farm_id, title: titleFromQuestion(x.question) })).id;
    if (x.replay) await store.truncateAfterLastUser(id);
    const batch: NewMessage[] = [];
    if (!x.replay) {
      batch.push({ role: "user", content: x.question, source: null, model: null, as_of: x.as_of, insight_id: x.insight_id, created_at: x.askedAt });
    }
    batch.push({ role: "assistant", content: x.answer, source: x.source, model: x.model, as_of: x.as_of, insight_id: null, created_at: x.answeredAt });
    const result = await store.append(id, batch);
    const message = result?.messages.at(-1);
    if (!result || !message) return null;
    return { conversation: result.conversation, message, ...(x.replay ? {} : { user_message: result.messages[0] }) };
  } catch (error) {
    console.warn("[chat] Could not save the conversation (the answer is still returned):", messageOf(error));
    return null;
  }
}
