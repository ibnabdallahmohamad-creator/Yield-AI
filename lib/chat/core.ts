/**
 * Chat storage building blocks shared by the local and Supabase stores: the `ChatStore`
 * interface, limits and pure text helpers. No server imports, so the browser may use the helpers.
 */
import type { Conversation, ConversationMessage, MessageFeedback } from "../ai/contract";
import { answerPreview } from "../ai/sections";

/** Per-owner and per-conversation caps; the oldest entries go first. */
export const CHAT_LIMITS = {
  conversations: 200,
  messagesPerConversation: 400,
  /** Stored turns sent to the model with each question. */
  historyTurns: 12,
  previewChars: 140,
  titleChars: 48,
} as const;

export interface ConversationFilter {
  /** Only conversations about this farm. */
  farm?: string;
  /** Case-insensitive match on the title or any message. */
  q?: string;
}

export interface NewConversation {
  farm_id: string | null;
  title?: string;
}

export type ConversationUpdate = Partial<Pick<Conversation, "title" | "pinned" | "farm_id">>;

/** A message to store; ids are assigned by the store, `created_at` defaults to now. */
export type NewMessage = Omit<ConversationMessage, "id" | "conversation_id" | "created_at" | "feedback"> & {
  created_at?: string;
};

export interface ConversationWithMessages {
  conversation: Conversation;
  /** Oldest first. */
  messages: ConversationMessage[];
}

/** Storage for one owner's chats. Methods return null/false when the conversation is not theirs. */
export interface ChatStore {
  /** Newest first (by `updated_at`), at most `CHAT_LIMITS.conversations`. */
  list(filter?: ConversationFilter): Promise<Conversation[]>;
  create(input: NewConversation): Promise<Conversation>;
  get(id: string): Promise<ConversationWithMessages | null>;
  update(id: string, patch: ConversationUpdate): Promise<Conversation | null>;
  remove(id: string): Promise<boolean>;
  /** Append messages, bumping `updated_at`, `preview` and `message_count`; returns the stored messages. */
  append(id: string, messages: NewMessage[]): Promise<ConversationWithMessages | null>;
  /** Drop the replies after the last user message; returns that message (null if there is none). */
  truncateAfterLastUser(id: string): Promise<ConversationMessage | null>;
  /** Rate an assistant message; `null` clears the rating. */
  setFeedback(id: string, messageId: string, feedback: MessageFeedback | null): Promise<ConversationMessage | null>;
}

/** The storage backend failed (not "not found"); route handlers answer 503. */
export class ChatStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChatStoreError";
  }
}

export const DEFAULT_CONVERSATION_TITLE = "New chat";

/** Cut `text` to at most `max` chars on a word boundary, adding "…" when shortened. */
export function truncateText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space >= max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** Title for a conversation started by `question`. */
export function titleFromQuestion(question: string): string {
  return truncateText(question, CHAT_LIMITS.titleChars) || DEFAULT_CONVERSATION_TITLE;
}

/** One-line preview of a message for the history list (markdown markers stripped). */
export function previewOf(content: string): string {
  // A model answer in JSON previews as its summary, not as "{"task": …".
  const plain = answerPreview(content)
    .replace(/\*\*|__|`/g, "")
    .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "");
  return truncateText(plain, CHAT_LIMITS.previewChars);
}

/** Newest first; ties broken by creation time, then id, so the order is stable. */
export function compareConversations(a: Conversation, b: Conversation): number {
  return b.updated_at.localeCompare(a.updated_at) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
}

let lastNow = 0;

/** ISO "now" that never repeats within the process, so ordering by timestamp is stable. */
export function nowIso(): string {
  lastNow = Math.max(Date.now(), lastNow + 1);
  return new Date(lastNow).toISOString();
}

/** Timestamps for a batch of new messages: the given time (or now), strictly increasing and after `after`. */
export function stampMessages(messages: NewMessage[], after?: string | null): string[] {
  const floor = after ? Date.parse(after) : Number.NaN;
  let last = Number.isFinite(floor) ? floor : Number.NEGATIVE_INFINITY;
  return messages.map((m) => {
    const wanted = m.created_at ? Date.parse(m.created_at) : Number.NaN;
    const t = Math.max(Number.isFinite(wanted) ? wanted : Date.parse(nowIso()), last + 1);
    last = t;
    return new Date(t).toISOString();
  });
}

/** The later of two ISO timestamps. */
export function laterIso(a: string, b: string): string {
  return Date.parse(b) > Date.parse(a) ? b : a;
}
