/**
 * Browser helpers for the assistant: POST /api/chat and the saved-chat API (/api/conversations).
 * Failures become a `ChatClientError` with a friendly message; aborts (a Stop button) are
 * rethrown untouched. No server imports.
 */
import type {
  ChatRequest,
  ChatResponse,
  Conversation,
  ConversationCreate,
  ConversationMessage,
  ConversationPatch,
  MessageFeedback,
} from "../ai/contract";
import type { ConversationWithMessages } from "./core";

const SIGNED_OUT = "Your session has ended. Sign in again to keep chatting.";
const OFFLINE = "I couldn't reach the server. Check the connection and try again.";
const ASSISTANT_DOWN = "The assistant is unavailable right now. Please try again.";
const HISTORY_DOWN = "Chat history is unavailable right now.";

export class ChatClientError extends Error {
  /** HTTP status (0 when the server could not be reached). */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatClientError";
    this.status = status;
  }
}

/** True when a request was cancelled through its AbortSignal. */
export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

async function request<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal; fallback: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error) || init.signal?.aborted) throw error;
    throw new ChatClientError(OFFLINE, 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (error) {
    if (isAbortError(error) || init.signal?.aborted) throw error;
  }
  if (res.status === 401) throw new ChatClientError(SIGNED_OUT, 401);
  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new ChatClientError(typeof message === "string" && message ? message : init.fallback, res.status);
  }
  return body as T;
}

const conversationUrl = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

/** GET /api/conversations — newest first; the caller groups pinned ones. */
export async function listConversations(
  filter: { farm?: string; q?: string } = {},
  signal?: AbortSignal,
): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (filter.farm) params.set("farm", filter.farm);
  if (filter.q?.trim()) params.set("q", filter.q.trim());
  const query = params.toString();
  const body = await request<{ conversations: Conversation[] }>(`/api/conversations${query ? `?${query}` : ""}`, {
    signal,
    fallback: HISTORY_DOWN,
  });
  return body.conversations;
}

export async function createConversation(input: ConversationCreate): Promise<Conversation> {
  const body = await request<{ conversation: Conversation }>("/api/conversations", {
    method: "POST",
    body: input,
    fallback: HISTORY_DOWN,
  });
  return body.conversation;
}

/** One conversation with its messages (oldest first). A deleted or foreign id → ChatClientError 404. */
export function getConversation(id: string, signal?: AbortSignal): Promise<ConversationWithMessages> {
  return request<ConversationWithMessages>(conversationUrl(id), { signal, fallback: HISTORY_DOWN });
}

/** Rename, pin/unpin or move to another farm. */
export async function updateConversation(id: string, patch: ConversationPatch): Promise<Conversation> {
  const body = await request<{ conversation: Conversation }>(conversationUrl(id), {
    method: "PATCH",
    body: patch,
    fallback: HISTORY_DOWN,
  });
  return body.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await request<{ ok: true }>(conversationUrl(id), { method: "DELETE", fallback: HISTORY_DOWN });
}

/** Thumbs up/down on an assistant message; `null` clears it. */
export async function setMessageFeedback(
  conversationId: string,
  messageId: string,
  feedback: MessageFeedback | null,
): Promise<ConversationMessage> {
  const body = await request<{ message: ConversationMessage }>(
    `${conversationUrl(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: { feedback }, fallback: HISTORY_DOWN },
  );
  return body.message;
}

/**
 * POST /api/chat. With `conversation_id` or `new_conversation` the exchange is saved and the
 * response carries `conversation`, `user_message` and `message`; `conversation_id` is null when
 * nothing was saved.
 */
export async function sendChat(body: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  const res = await request<ChatResponse | null>("/api/chat", { method: "POST", body, signal, fallback: ASSISTANT_DOWN });
  if (!res?.answer) throw new ChatClientError(ASSISTANT_DOWN, 502);
  return res;
}
