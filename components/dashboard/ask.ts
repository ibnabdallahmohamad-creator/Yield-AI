import type { ChatAnswer } from "@/components/dashboard/chat-panel";
import type { ChatResponse, ChatTurn } from "@/lib/ai/contract";

/** POST /api/chat for one farm. Failures become friendly messages (never raw errors). */
export async function askAgronomist(farmId: string, date: string | undefined, question: string, history: ChatTurn[]): Promise<ChatAnswer> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ farm_id: farmId, question, date, history }),
    });
  } catch {
    throw new Error("I couldn't reach the server. Check the connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (ChatResponse & { error?: string }) | null;
  if (res.status === 401) throw new Error("Your session has ended. Sign in again to keep chatting.");
  if (!res.ok || !body?.answer) throw new Error(body?.error ?? "The assistant is unavailable right now. Please try again.");
  return { answer: body.answer, source: body.source, model: body.model };
}
