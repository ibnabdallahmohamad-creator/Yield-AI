import { NextResponse, type NextRequest } from "next/server";
import { ConversationCreateSchema } from "@/lib/ai/contract";
import { NO_STORE, chatFailure, readBody, userChatStore } from "@/lib/chat/api";

/** GET /api/conversations?farm=<id>&q=<text> → { conversations } (newest first, at most 200). */
export async function GET(request: NextRequest) {
  const auth = await userChatStore();
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const farm = params.get("farm")?.trim().slice(0, 64) || undefined;
  const q = params.get("q")?.trim().slice(0, 200) || undefined;
  try {
    const conversations = await auth.store.list({ farm, q });
    return NextResponse.json({ conversations }, { headers: NO_STORE });
  } catch (error) {
    return chatFailure(error, "Listing chats");
  }
}

/** POST /api/conversations — { farm_id, title? } → 201 { conversation }. */
export async function POST(request: Request) {
  const auth = await userChatStore();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, ConversationCreateSchema);
  if ("response" in body) return body.response;
  try {
    const conversation = await auth.store.create({ farm_id: body.data.farm_id, title: body.data.title });
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return chatFailure(error, "Creating a chat");
  }
}
