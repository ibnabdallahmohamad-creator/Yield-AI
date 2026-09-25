"use client";

import { ArrowUp, Loader2, MessageCircleQuestion, RotateCcw } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { AnswerText, AssistantMark, sourceText, ThinkingDots } from "@/components/assistant/message-parts";
import { InfoTip } from "@/components/dashboard/info-tip";
import { Button } from "@/components/ui/button";
import type { ChatAnswerSource, ChatTurn } from "@/lib/ai/contract";
import { cn } from "@/lib/utils";

export interface ChatAnswer {
  answer: string;
  source: ChatAnswerSource;
  model: string | null;
}

export type AskFn = (question: string, history: ChatTurn[]) => Promise<ChatAnswer>;

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  source?: ChatAnswerSource;
  model?: string | null;
  error?: boolean;
  /** Reveal with the typewriter effect (only for answers that just arrived). */
  animate?: boolean;
}

let nextId = 1;

function AssistantMessage({
  message,
  onTyped,
  onProgress,
  onRetry,
}: {
  message: Message;
  onTyped: (id: number) => void;
  onProgress: () => void;
  onRetry?: () => void;
}) {
  const typing = Boolean(message.animate);

  return (
    <div className="flex gap-2.5">
      <AssistantMark className="mt-0.5" tone={message.error ? "warn" : "primary"} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed",
            message.error ? "bg-risk-medium-soft text-risk-medium-ink" : "bg-card ring-1 ring-border",
          )}
        >
          <AnswerText content={message.content} animate={typing} onTyped={() => onTyped(message.id)} onProgress={onProgress} />
        </div>
        {message.error && onRetry ? (
          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={onRetry}>
            <RotateCcw className="size-3" /> Try again
          </Button>
        ) : message.source && !typing ? (
          <p className="mt-1 pl-1 text-xs text-muted-foreground">{sourceText(message.source, message.model)}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Chat with the agronomist assistant about one farm. Conversations are kept per farm while the
 * page is open. `ask` decides where answers come from (the API, or canned demo answers).
 */
export function ChatPanel({
  conversationKey,
  subject,
  chips,
  ask,
  className,
  compact = false,
  showHeader = true,
  composer = true,
  footer,
  onActiveChange,
}: {
  /** Conversations are stored per key (the farm id). */
  conversationKey: string;
  /** Shown in the empty state and placeholder, e.g. the farm name. */
  subject: string;
  chips: string[];
  ask: AskFn;
  className?: string;
  compact?: boolean;
  showHeader?: boolean;
  /** Free-text input; without it the chips are the only way to ask (landing-page demo). */
  composer?: boolean;
  /** Shown under the conversation when there is no composer. */
  footer?: React.ReactNode;
  /** Called when the current conversation starts or is cleared (lets the page give the chat more room). */
  onActiveChange?: (active: boolean) => void;
}) {
  const [conversations, setConversations] = useState<Record<string, Message[]>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  const messages = conversations[conversationKey] ?? [];
  const pending = pendingKey === conversationKey;
  const typing = messages.some((m) => m.animate);
  const busy = pending || typing;

  const active = messages.length > 0 || pending;
  const reportActive = useEffectEvent((value: boolean) => onActiveChange?.(value));
  useEffect(() => {
    reportActive(active);
  }, [active]);

  // Follow the answer as it types, but stop once the question reaches the top so a long answer
  // is read from its first line.
  const follow = () => {
    const el = listRef.current;
    if (!el) return;
    const end = el.scrollHeight - el.clientHeight;
    const question = questionRef.current;
    el.scrollTop = question ? Math.min(end, Math.max(0, question.offsetTop - 12)) : end;
  };

  useEffect(() => {
    follow();
  }, [messages.length, pending, conversationKey]);

  const update = (key: string, fn: (list: Message[]) => Message[]) =>
    setConversations((all) => ({ ...all, [key]: fn(all[key] ?? []) }));

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    const key = conversationKey;
    const history: ChatTurn[] = (conversations[key] ?? [])
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    update(key, (list) => [...list, { id: nextId++, role: "user", content: question }]);
    setDraft("");
    setPendingKey(key);
    try {
      const res = await ask(question, history);
      update(key, (list) => [
        ...list,
        { id: nextId++, role: "assistant", content: res.answer, source: res.source, model: res.model, animate: true },
      ]);
    } catch (error) {
      const message =
        error instanceof Error && error.message && !/fetch|network|json/i.test(error.message)
          ? error.message
          : "I couldn't reach the assistant just now. Check the connection and try again.";
      update(key, (list) => [...list, { id: nextId++, role: "assistant", content: message, error: true }]);
    } finally {
      setPendingKey((k) => (k === key ? null : k));
    }
  };

  const retry = () => {
    const lastQuestion = [...messages].reverse().find((m) => m.role === "user");
    if (!lastQuestion) return;
    update(conversationKey, (list) => list.filter((m) => !m.error));
    void send(lastQuestion.content);
  };

  const markTyped = (id: number) =>
    update(conversationKey, (list) => list.map((m) => (m.id === id ? { ...m, animate: false } : m)));

  const empty = messages.length === 0 && !pending;
  const lastQuestionId = messages.findLast((m) => m.role === "user")?.id;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {showHeader ? (
        <div className="flex items-center gap-2 pb-2">
          <MessageCircleQuestion className="size-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Ask the agronomist</h3>
          <InfoTip label="Where answers come from">
            Answers use this farm&apos;s latest probe readings, trends and FAO-56 / FAO-29 values. The team&apos;s fine-tuned model
            answers when AI_SERVICE_URL is set, then Claude as a fallback, then the built-in agronomy engine — so the chat always
            works.
          </InfoTip>
          {messages.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs text-muted-foreground"
              onClick={() => update(conversationKey, () => [])}
              disabled={busy}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-busy={busy}
        aria-label={`Conversation about ${subject}`}
        className={cn(
          "scrollbar-thin relative min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-xl bg-sand-100/70 p-3 ring-1 ring-black/5 ring-inset",
          compact ? "max-h-80" : undefined,
        )}
      >
        {empty ? (
          <div className="flex h-full min-h-28 flex-col justify-center gap-2 px-1 py-2">
            <p className="text-sm text-muted-foreground">
              {composer ? "Ask anything about" : "Pick a question about"}{" "}
              <span className="font-semibold text-foreground">{subject}</span> — answers quote its probe readings.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => void send(chip)}
                  className="rounded-full border border-primary/25 bg-card px-3 py-1.5 text-left text-sm font-medium text-primary shadow-xs transition-colors hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} ref={m.id === lastQuestionId ? questionRef : undefined} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm leading-snug text-primary-foreground">
                {m.content}
              </p>
            </div>
          ) : (
            <AssistantMessage key={m.id} message={m} onTyped={markTyped} onProgress={follow} onRetry={m.error ? retry : undefined} />
          ),
        )}
        {pending ? (
          <div className="flex items-center gap-2.5" aria-label="The assistant is thinking">
            <AssistantMark />
            <span className="inline-flex rounded-2xl rounded-tl-md bg-card px-3.5 py-3 ring-1 ring-border">
              <ThinkingDots />
            </span>
          </div>
        ) : null}
      </div>

      {!empty ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Suggested questions">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => void send(chip)}
              disabled={busy}
              className="shrink-0 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      {composer ? (
        <form
          className="mt-2 flex items-end gap-2 rounded-xl border bg-card p-1.5 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Ask a question about {subject}
          </label>
          <textarea
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            maxLength={1000}
            placeholder={`Ask about ${subject}…`}
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-snug outline-none placeholder:text-muted-foreground/80"
          />
          <Button type="submit" size="icon" className="size-9 shrink-0 rounded-lg" disabled={busy || !draft.trim()} aria-label="Send question">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </form>
      ) : (
        footer
      )}
    </div>
  );
}
