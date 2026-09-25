import type { ChatAnswerSource, Conversation, MessageFeedback, RiskLevel } from "@/lib/ai/contract";
import type { ConversationWithMessages } from "@/lib/chat/core";
import type { HealthTone } from "@/lib/dashboard";

/** What the assistant knows about each farm (kept small: no readings are sent to the browser). */
export interface AssistantFarm {
  id: string;
  name: string;
  crop: string;
  riskLevel: RiskLevel | null;
  /** Two or three words, e.g. "Salt rising". */
  reason: string;
  reasonTone: HealthTone;
  /** One plain sentence on what is happening at the farm. */
  headline: string;
  /** Four starter prompts for the empty state. */
  prompts: string[];
  /** False until the farm's first probe reading: there is nothing to answer from yet. */
  hasReadings: boolean;
}

/** Everything the assistant page needs on first paint. */
export interface AssistantBoot {
  farms: AssistantFarm[];
  /** Days the numbers can be "as of", oldest first; the last one is today. */
  dates: string[];
  /** Today in Qatar (YYYY-MM-DD), for grouping the history the same way on server and browser. */
  today: string;
  user: { name: string; email: string };
  initialFarmId: string | null;
  /** /dashboard/assistant/[id]: the requested id, the chat, or why it couldn't be opened. */
  conversationId: string | null;
  conversation: ConversationWithMessages | null;
  conversationError: "not-found" | "unavailable" | null;
  /** Saved chats (null when the history couldn't be loaded; the browser retries). */
  list: Conversation[] | null;
  /** `?q=`: a question to send once on arrival (with `?insight=`). */
  question: string | null;
  insightId: string | null;
}

/** One message in the open thread (saved or still in flight). */
export interface ThreadMessage {
  /** Stable React key (the stored id once saved). */
  key: string;
  /** Stored message id; null until saved (or when the chat isn't being saved). */
  id: string | null;
  role: "user" | "assistant";
  content: string;
  source: ChatAnswerSource | null;
  model: string | null;
  /** The day the answer was grounded on. */
  asOf: string | null;
  feedback: MessageFeedback | null;
  /** Assistant: the request failed and `content` explains why; `retry` says how to try again. */
  error?: { retry: "send" | "regenerate" } | null;
  /** Assistant: a fresh answer that types itself out once. */
  animate?: boolean;
  /** User: Stop was pressed before the answer arrived. */
  stopped?: boolean;
}
