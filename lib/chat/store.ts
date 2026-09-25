/**
 * Saved chats: pick the storage for the signed-in user. Supabase users get the `conversations`
 * tables (row-level security does ownership); local accounts get a JSON file per owner.
 */
import "server-only";
import type { AppUser } from "../auth/session";
import { env } from "../env";
import type { ChatStore } from "./core";
import { LocalChatStore, chatOwnerKey } from "./local-store";
import { SupabaseChatStore } from "./supabase-store";

export * from "./core";

export function getChatStore(user: AppUser): ChatStore {
  if (user.provider === "supabase" && env.supabaseConfigured) return new SupabaseChatStore();
  return new LocalChatStore(chatOwnerKey(user));
}
