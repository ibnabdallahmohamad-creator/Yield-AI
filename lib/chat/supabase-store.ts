/**
 * Saved chats for Supabase users: `conversations` + `messages` tables
 * (supabase/migrations/0002_conversations.sql). Uses the user's session client, so row-level
 * security enforces ownership. Every failure surfaces as a `ChatStoreError`.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnswerSource, Conversation, ConversationMessage, MessageFeedback } from "../ai/contract";
import { createSupabaseServerClient, withTimeout } from "../supabase/server";
import {
  CHAT_LIMITS,
  ChatStoreError,
  DEFAULT_CONVERSATION_TITLE,
  compareConversations,
  laterIso,
  nowIso,
  previewOf,
  stampMessages,
  type ChatStore,
  type ConversationFilter,
  type ConversationUpdate,
  type ConversationWithMessages,
  type NewConversation,
  type NewMessage,
} from "./core";

const TIMEOUT_MS = 5000;
const CONVERSATION_COLUMNS = "id, farm_id, title, pinned, preview, message_count, created_at, updated_at";
const MESSAGE_COLUMNS = "id, conversation_id, role, content, source, model, as_of, insight_id, feedback, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres foreign_key_violation: the farm isn't in `public.farms` (e.g. demo data with Supabase auth). */
const FOREIGN_KEY_VIOLATION = "23503";
const SOURCES: readonly ChatAnswerSource[] = ["ai-service", "llm", "offline"];

type Row = Record<string, unknown>;
interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const iso = (v: unknown): string => {
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : String(v);
};
const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);
const row = (data: unknown): Row | null => (data && typeof data === "object" && !Array.isArray(data) ? (data as Row) : null);

function toConversation(r: Row): Conversation {
  return {
    id: String(r.id),
    farm_id: text(r.farm_id),
    title: text(r.title) || DEFAULT_CONVERSATION_TITLE,
    pinned: r.pinned === true,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    preview: text(r.preview) ?? "",
    message_count: Number(r.message_count) || 0,
  };
}

function toMessage(r: Row): ConversationMessage {
  const source = text(r.source) as ChatAnswerSource | null;
  const feedback = text(r.feedback);
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    role: r.role === "assistant" ? "assistant" : "user",
    content: text(r.content) ?? "",
    source: source && SOURCES.includes(source) ? source : null,
    model: text(r.model),
    as_of: text(r.as_of),
    insight_id: text(r.insight_id),
    feedback: feedback === "up" || feedback === "down" ? feedback : null,
    created_at: iso(r.created_at),
  };
}

/** Escape LIKE wildcards so the search text matches literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const isForeignKeyError = (error: unknown) =>
  error instanceof ChatStoreError && (error.cause as { code?: string } | undefined)?.code === FOREIGN_KEY_VIOLATION;

export class SupabaseChatStore implements ChatStore {
  private client: Promise<SupabaseClient> | null = null;

  private db(): Promise<SupabaseClient> {
    this.client ??= createSupabaseServerClient().then((client) => {
      if (!client) throw new ChatStoreError("Supabase is not configured.");
      return client;
    });
    return this.client;
  }

  /** One query with a timeout; any failure (error, timeout, no client) becomes a ChatStoreError. */
  private async run(label: string, build: (db: SupabaseClient) => PromiseLike<QueryResult>): Promise<QueryResult> {
    try {
      const result = await withTimeout(build(await this.db()), TIMEOUT_MS, `Supabase ${label}`);
      if (result.error) throw new ChatStoreError(`Chat storage failed (${label}): ${result.error.message}`, { cause: result.error });
      return result;
    } catch (error) {
      if (error instanceof ChatStoreError) throw error;
      throw new ChatStoreError(`Chat storage failed (${label}): ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  private async countMessages(id: string): Promise<number> {
    const res = await this.run("count messages", (db) =>
      db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", id),
    );
    return res.count ?? 0;
  }

  async list(filter: ConversationFilter = {}): Promise<Conversation[]> {
    const limit = CHAT_LIMITS.conversations;
    const q = filter.q?.trim();
    const pattern = q ? likePattern(q) : null;
    const byTitle = await this.run("list conversations", (db) => {
      let query = db.from("conversations").select(CONVERSATION_COLUMNS).order("updated_at", { ascending: false }).limit(limit);
      if (filter.farm) query = query.eq("farm_id", filter.farm);
      if (pattern) query = query.ilike("title", pattern);
      return query;
    });
    const found = rows(byTitle.data);
    if (pattern) {
      const hits = await this.run("search messages", (db) =>
        db.from("messages").select("conversation_id").ilike("content", pattern).order("created_at", { ascending: false }).limit(1000),
      );
      const known = new Set(found.map((r) => String(r.id)));
      const ids = [...new Set(rows(hits.data).map((r) => String(r.conversation_id)))].filter((id) => !known.has(id)).slice(0, 100); // keeps the `in (...)` URL short
      if (ids.length) {
        const more = await this.run("list matching conversations", (db) => {
          let query = db.from("conversations").select(CONVERSATION_COLUMNS).in("id", ids);
          if (filter.farm) query = query.eq("farm_id", filter.farm);
          return query;
        });
        found.push(...rows(more.data));
      }
    }
    return found.map(toConversation).sort(compareConversations).slice(0, limit);
  }

  async create(input: NewConversation): Promise<Conversation> {
    const now = nowIso();
    const insert = (farm_id: string | null) =>
      this.run("create conversation", (db) =>
        db
          .from("conversations")
          .insert({ farm_id, title: input.title?.trim() || DEFAULT_CONVERSATION_TITLE, created_at: now, updated_at: now })
          .select(CONVERSATION_COLUMNS)
          .single(),
      );
    let res: QueryResult;
    try {
      res = await insert(input.farm_id);
    } catch (error) {
      if (!input.farm_id || !isForeignKeyError(error)) throw error;
      res = await insert(null);
    }
    const created = row(res.data);
    if (!created) throw new ChatStoreError("Chat storage returned no conversation.");
    return toConversation(created);
  }

  async get(id: string): Promise<ConversationWithMessages | null> {
    if (!UUID.test(id)) return null;
    const [conv, msgs] = await Promise.all([
      this.run("get conversation", (db) => db.from("conversations").select(CONVERSATION_COLUMNS).eq("id", id).maybeSingle()),
      this.run("get messages", (db) =>
        db
          .from("messages")
          .select(MESSAGE_COLUMNS)
          .eq("conversation_id", id)
          .order("created_at", { ascending: false })
          .limit(CHAT_LIMITS.messagesPerConversation),
      ),
    ]);
    const conversation = row(conv.data);
    if (!conversation) return null;
    return { conversation: toConversation(conversation), messages: rows(msgs.data).map(toMessage).reverse() };
  }

  async update(id: string, patch: ConversationUpdate): Promise<Conversation | null> {
    if (!UUID.test(id)) return null;
    const changes: Row = { updated_at: nowIso() };
    if (patch.title !== undefined) changes.title = patch.title.trim() || DEFAULT_CONVERSATION_TITLE;
    if (patch.pinned !== undefined) changes.pinned = patch.pinned;
    if (patch.farm_id !== undefined) changes.farm_id = patch.farm_id;
    const save = (values: Row) =>
      this.run("update conversation", (db) =>
        db.from("conversations").update(values).eq("id", id).select(CONVERSATION_COLUMNS).maybeSingle(),
      );
    let res: QueryResult;
    try {
      res = await save(changes);
    } catch (error) {
      if (!changes.farm_id || !isForeignKeyError(error)) throw error;
      res = await save({ ...changes, farm_id: null });
    }
    const updated = row(res.data);
    return updated ? toConversation(updated) : null;
  }

  async remove(id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const res = await this.run("delete conversation", (db) => db.from("conversations").delete().eq("id", id).select("id"));
    return rows(res.data).length > 0;
  }

  async append(id: string, messages: NewMessage[]): Promise<ConversationWithMessages | null> {
    if (!UUID.test(id)) return null;
    const current = await this.run("get conversation", (db) =>
      db.from("conversations").select("id, updated_at").eq("id", id).maybeSingle(),
    );
    const conversation = row(current.data);
    if (!conversation) return null;
    if (!messages.length) return this.get(id);

    const stamps = stampMessages(messages, text(conversation.updated_at));
    const inserted = await this.run("save messages", (db) =>
      db
        .from("messages")
        .insert(
          messages.map((m, i) => ({
            conversation_id: id,
            role: m.role,
            content: m.content,
            source: m.source,
            model: m.model,
            as_of: m.as_of,
            insight_id: m.insight_id,
            created_at: stamps[i],
          })),
        )
        .select(MESSAGE_COLUMNS),
    );
    const stored = rows(inserted.data)
      .map(toMessage)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    let total = await this.countMessages(id);
    const excess = total - CHAT_LIMITS.messagesPerConversation;
    if (excess > 0) {
      const oldest = await this.run("find old messages", (db) =>
        db.from("messages").select("id").eq("conversation_id", id).order("created_at", { ascending: true }).limit(excess),
      );
      const ids = rows(oldest.data).map((r) => String(r.id));
      if (ids.length) await this.run("trim messages", (db) => db.from("messages").delete().in("id", ids));
      total -= ids.length;
    }

    const last = stored.at(-1);
    const updated = await this.run("update conversation", (db) =>
      db
        .from("conversations")
        .update({
          preview: last ? previewOf(last.content) : "",
          message_count: total,
          updated_at: last ? laterIso(nowIso(), last.created_at) : nowIso(),
        })
        .eq("id", id)
        .select(CONVERSATION_COLUMNS)
        .maybeSingle(),
    );
    const saved = row(updated.data);
    return saved ? { conversation: toConversation(saved), messages: stored } : null;
  }

  async truncateAfterLastUser(id: string): Promise<ConversationMessage | null> {
    if (!UUID.test(id)) return null;
    const res = await this.run("find last question", (db) =>
      db
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    const lastUser = row(res.data);
    if (!lastUser) return null;
    // Compare against the stored value itself: it may carry more precision than an ISO string.
    const removed = await this.run("drop replies", (db) =>
      db.from("messages").delete().eq("conversation_id", id).gt("created_at", String(lastUser.created_at)).select("id"),
    );
    const message = toMessage(lastUser);
    if (rows(removed.data).length) {
      const total = await this.countMessages(id);
      await this.run("update conversation", (db) =>
        db.from("conversations").update({ preview: previewOf(message.content), message_count: total }).eq("id", id),
      );
    }
    return message;
  }

  async setFeedback(id: string, messageId: string, feedback: MessageFeedback | null): Promise<ConversationMessage | null> {
    if (!UUID.test(id) || !UUID.test(messageId)) return null;
    const res = await this.run("save feedback", (db) =>
      db
        .from("messages")
        .update({ feedback })
        .eq("id", messageId)
        .eq("conversation_id", id)
        .eq("role", "assistant")
        .select(MESSAGE_COLUMNS)
        .maybeSingle(),
    );
    const updated = row(res.data);
    return updated ? toMessage(updated) : null;
  }
}
