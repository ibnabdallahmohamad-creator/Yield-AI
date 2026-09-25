import { NextResponse, type NextRequest } from "next/server";
import { ConversationPatchSchema } from "@/lib/ai/contract";
import { CONVERSATION_NOT_FOUND, NO_STORE, chatFailure, jsonError, readBody, userChatStore } from "@/lib/chat/api";

/** GET /api/conversations/[id] → { conversation, messages } (messages oldest first). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/conversations/[id]">) {
  const auth = await userChatStore();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const thread = await auth.store.get(id);
    if (!thread) return jsonError(CONVERSATION_NOT_FOUND, 404);
    return NextResponse.json(thread, { headers: NO_STORE });
  } catch (error) {
    return chatFailure(error, "Loading a chat");
  }
}

/** PATCH /api/conversations/[id] — { title?, pinned?, farm_id? } → { conversation }. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/conversations/[id]">) {
  const auth = await userChatStore();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, ConversationPatchSchema);
  if ("response" in body) return body.response;
  const { id } = await ctx.params;
  try {
    const conversation = await auth.store.update(id, body.data);
    if (!conversation) return jsonError(CONVERSATION_NOT_FOUND, 404);
    return NextResponse.json({ conversation });
  } catch (error) {
    return chatFailure(error, "Updating a chat");
  }
}

/** DELETE /api/conversations/[id] → { ok: true }. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/conversations/[id]">) {
  const auth = await userChatStore();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    if (!(await auth.store.remove(id))) return jsonError(CONVERSATION_NOT_FOUND, 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return chatFailure(error, "Deleting a chat");
  }
}
