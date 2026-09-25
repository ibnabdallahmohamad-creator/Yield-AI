import type { Metadata } from "next";
import { AssistantApp } from "@/components/assistant/assistant-app";
import { requireUser } from "@/lib/auth/session";
import { loadAssistant } from "../load";

export const metadata: Metadata = { title: "Assistant" };

/** /dashboard/assistant/[id] — a saved chat. */
export default async function ConversationPage({ params }: PageProps<"/dashboard/assistant/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/dashboard/assistant/${encodeURIComponent(id)}`);
  const boot = await loadAssistant(user, { conversationId: id });
  return <AssistantApp boot={boot} />;
}
