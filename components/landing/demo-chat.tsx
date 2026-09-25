"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { ChatPanel, type AskFn } from "@/components/dashboard/chat-panel";
import type { ShowcaseAnswer } from "@/lib/data/showcase";

/**
 * Landing-page chat: the dashboard's chat panel with three preset questions. Answers were computed
 * on the server by the built-in agronomy engine from the demo farm's readings, then type out here.
 */
export function DemoChat({ farmName, answers }: { farmName: string; answers: ShowcaseAnswer[] }) {
  const ask: AskFn = useCallback(
    async (question) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const found = answers.find((a) => a.question === question);
      if (!found) throw new Error("Open the dashboard to ask your own questions.");
      return { answer: found.answer, source: "offline", model: "agronomy-rules" };
    },
    [answers],
  );

  return (
    <ChatPanel
      conversationKey="landing-demo"
      subject={farmName}
      chips={answers.map((a) => a.question)}
      ask={ask}
      showHeader={false}
      composer={false}
      className="h-full min-h-0"
      footer={
        <Link
          href="/dashboard"
          className="mt-2.5 inline-flex items-center gap-1 self-start rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          Ask your own questions in the dashboard <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
    />
  );
}
