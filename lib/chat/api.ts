/**
 * Shared plumbing for the saved-chat route handlers: auth, JSON bodies and friendly errors.
 */
import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getCurrentUser } from "../auth/session";
import { ChatStoreError, getChatStore, type ChatStore } from "./store";

export const NO_STORE = { "Cache-Control": "no-store" };
export const CONVERSATION_NOT_FOUND = "That chat doesn't exist or was deleted.";

export const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

/** The signed-in user's chat store, or a 401 response. */
export async function userChatStore(): Promise<{ store: ChatStore } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Please sign in to see your chats.", 401) };
  return { store: getChatStore(user) };
}

/** Parse a JSON body against `schema`, or a 400 response with the first issue. */
export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { response: jsonError("Send a JSON body.", 400) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { response: jsonError(parsed.error.issues[0]?.message ?? "Invalid request.", 400) };
  return { data: parsed.data };
}

/** Storage outages → 503; anything unexpected → 500. Never leaks internals. */
export function chatFailure(error: unknown, action: string): NextResponse {
  if (error instanceof ChatStoreError) {
    console.warn(`[chat] ${action} failed:`, error.message);
    return jsonError("Chat history is unavailable right now.", 503);
  }
  console.error(`[chat] ${action} failed:`, error);
  return jsonError("Something went wrong with your chats. Please try again.", 500);
}
