"use client";

/**
 * Message pieces shared by the full-screen assistant and the landing page's demo chat:
 * the answer text (with the typewriter reveal), the "thinking" dots and the source labels.
 */
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Markdown } from "@/components/dashboard/markdown";
import { useStagedReveal, useTypewriter } from "@/hooks/use-typewriter";
import type { ChatAnswerSource } from "@/lib/ai/contract";
import { isStructuredAnswer, parseAnswer } from "@/lib/ai/sections";
import { cn } from "@/lib/utils";
import { AnswerView } from "./answer-view";

export const SOURCE_LABEL: Record<ChatAnswerSource, string> = {
  "ai-service": "Yield AI model",
  llm: "Claude · LLM fallback",
  offline: "Built-in agronomy engine",
};

/** "Built-in agronomy engine" / "Claude · LLM fallback (claude-…)". */
export function sourceText(source: ChatAnswerSource, model: string | null | undefined): string {
  return `${SOURCE_LABEL[source]}${source === "llm" && model ? ` (${model})` : ""}`;
}

/** The small ✦ mark in front of assistant answers. */
export function AssistantMark({ className, tone = "primary" }: { className?: string; tone?: "primary" | "warn" }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        tone === "warn" ? "bg-risk-medium-soft text-risk-medium-ink" : "bg-primary text-primary-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/**
 * An answer split into sections (lib/ai/sections.ts). The fine-tuned model's JSON is revealed section by
 * section; Markdown and text type out (about 2 s) and fall into sections as their headings arrive. All
 * of it shows at once with reduced motion. `onProgress` fires while it reveals so the page can follow
 * it, `onTyped` when done.
 */
export function AnswerText({
  content,
  animate,
  onTyped,
  onProgress,
  className,
}: {
  content: string;
  animate: boolean;
  onTyped?: () => void;
  onProgress?: () => void;
  className?: string;
}) {
  const structured = useMemo(() => isStructuredAnswer(content), [content]);
  const parsed = useMemo(() => parseAnswer(content), [content]);
  const { shown, typing } = useTypewriter(content, animate && !structured, onTyped);
  const blocks = parsed.sections.length + (parsed.summary ? 1 : 0);
  const { visible, revealing } = useStagedReveal(blocks, animate && structured, onTyped);
  const progress = useRef(onProgress);
  useEffect(() => {
    progress.current = onProgress;
  });
  useEffect(() => {
    if (typing || revealing) progress.current?.();
  }, [shown, typing, visible, revealing]);

  if (structured) {
    // The summary counts as the first block when there is one.
    const sectionsShown = parsed.summary ? visible : visible + 1;
    return <AnswerView answer={parsed} visible={sectionsShown} className={className} />;
  }
  if (parsed.format === "markdown") {
    return (
      <div className={cn(typing && "yai-caret", className)}>
        <AnswerView answer={typing ? parseAnswer(shown) : parsed} />
      </div>
    );
  }
  return (
    <div className={cn(typing && "yai-caret", className)}>
      <Markdown text={shown} />
    </div>
  );
}

/** Three bouncing dots while the assistant works on an answer. */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden="true">
      <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.3s] motion-reduce:animate-none" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.15s] motion-reduce:animate-none" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/60 motion-reduce:animate-none" />
    </span>
  );
}
