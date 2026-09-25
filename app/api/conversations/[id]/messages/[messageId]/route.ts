import { NextResponse, type NextRequest } from "next/server";
import { MessageFeedbackSchema } from "@/lib/ai/contract";
import { chatFailure, jsonError, readBody, userChatStore } from "@/lib/chat/api";

/** PATCH /api/conversations/[id]/messages/[messageId] — { feedback: "up" | "down" | null } → { message }. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/conversations/[id]/messages/[messageId]">) {
  const auth = await userChatStore();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, MessageFeedbackSchema);
  if ("response" in body) return body.response;
  const { id, messageId } = await ctx.params;
  try {
    const message = await auth.store.setFeedback(id, messageId, body.data.feedback);
    if (!message) return jsonError("That answer doesn't exist or was deleted.", 404);
    return NextResponse.json({ message });
  } catch (error) {
    return chatFailure(error, "Saving feedback");
  }
}
