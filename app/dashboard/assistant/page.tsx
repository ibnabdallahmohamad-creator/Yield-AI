import type { Metadata } from "next";
import { AssistantApp } from "@/components/assistant/assistant-app";
import { requireUser } from "@/lib/auth/session";
import { loadAssistant } from "./load";

export const metadata: Metadata = { title: "Assistant" };

/** /dashboard/assistant — a new chat (`?farm=` picks the farm, `?q=` sends a first question). */
export default async function AssistantPage({ searchParams }: PageProps<"/dashboard/assistant">) {
  const user = await requireUser("/dashboard/assistant");
  const { farm, q, insight } = await searchParams;
  const boot = await loadAssistant(user, { farm, q, insight });
  return <AssistantApp boot={boot} />;
}
