"use client";

import { ArrowRight, Check, Copy, MessageSquareOff, Plus, RefreshCw, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MessageFeedback } from "@/lib/ai/contract";
import { answerToMarkdown } from "@/lib/ai/sections";
import { asOfLabel } from "@/lib/assistant";
import { cn } from "@/lib/utils";
import { AnswerText, AssistantMark, sourceText, ThinkingDots } from "./message-parts";
import type { AssistantFarm, ThreadMessage } from "./types";

/** Icon-only action under an answer: 44 px on phones, 32 px with a mouse. */
function ActionButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-40 sm:size-8",
            pressed && "text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <ActionButton
      label={copied ? "Copied" : "Copy answer"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    </ActionButton>
  );
}

function UserMessage({ message, latest, onRetry }: { message: ThreadMessage; latest: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-base leading-7 break-words whitespace-pre-wrap text-foreground">
        {message.content}
      </div>
      {message.stopped ? (
        <p className="flex items-center gap-2 pr-1 text-xs text-muted-foreground">
          <span>Stopped</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-11 items-center gap-1 rounded-md px-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:h-auto"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" /> Ask again
            </button>
          ) : null}
        </p>
      ) : message.asOf && message.asOf !== latest ? (
        <p className="pr-1 text-xs text-muted-foreground">as of {asOfLabel(message.asOf, latest)}</p>
      ) : null}
    </div>
  );
}

function AnswerLabel({ tone = "primary" }: { tone?: "primary" | "warn" }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <AssistantMark tone={tone} className="size-6" />
      <span className="text-sm font-semibold text-foreground">Yield AI</span>
    </div>
  );
}

function AssistantMessage({
  message,
  latest,
  isLast,
  canRegenerate,
  canRate,
  onTyped,
  onProgress,
  onRegenerate,
  onFeedback,
  onRetry,
}: {
  message: ThreadMessage;
  latest: string;
  isLast: boolean;
  canRegenerate: boolean;
  canRate: boolean;
  onTyped: () => void;
  onProgress: () => void;
  onRegenerate: () => void;
  onFeedback: (value: MessageFeedback | null) => void;
  onRetry: () => void;
}) {
  const [typing, setTyping] = useState(Boolean(message.animate));
  if (message.error) {
    return (
      <div role="alert">
        <AnswerLabel tone="warn" />
        <p className="text-base leading-7 text-foreground">{message.content}</p>
        <Button variant="outline" className="mt-3 h-11 rounded-xl px-3 sm:h-9" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }
  return (
    <div>
      <AnswerLabel />
      <AnswerText
        content={message.content}
        animate={Boolean(message.animate)}
        onProgress={onProgress}
        onTyped={() => {
          setTyping(false);
          onTyped();
        }}
        className="text-base leading-7 text-foreground"
      />
      <div className={cn("mt-2 -ml-2 flex flex-wrap items-center gap-0.5 transition-opacity duration-200", typing && "invisible opacity-0")}>
        <CopyButton text={answerToMarkdown(message.content)} />
        {isLast && canRegenerate ? (
          <ActionButton label="Regenerate answer" onClick={onRegenerate}>
            <RefreshCw className="size-4" aria-hidden="true" />
          </ActionButton>
        ) : null}
        {canRate && message.id ? (
          <>
            <ActionButton
              label={message.feedback === "up" ? "Remove “good answer”" : "Good answer"}
              pressed={message.feedback === "up"}
              onClick={() => onFeedback(message.feedback === "up" ? null : "up")}
            >
              <ThumbsUp className={cn("size-4", message.feedback === "up" && "fill-current")} aria-hidden="true" />
            </ActionButton>
            <ActionButton
              label={message.feedback === "down" ? "Remove “bad answer”" : "Bad answer"}
              pressed={message.feedback === "down"}
              onClick={() => onFeedback(message.feedback === "down" ? null : "down")}
            >
              <ThumbsDown className={cn("size-4", message.feedback === "down" && "fill-current")} aria-hidden="true" />
            </ActionButton>
          </>
        ) : null}
        {message.source ? (
          <span className="ml-2 text-xs text-muted-foreground">
            {sourceText(message.source, message.model)}
            {message.asOf && message.asOf !== latest ? ` · as of ${asOfLabel(message.asOf, latest)}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The conversation: questions on the right, answers full width, then follow-up suggestions. */
export function Thread({
  messages,
  pending,
  farm,
  latest,
  saved,
  followUps,
  onAsk,
  onRetry,
  onRegenerate,
  onFeedback,
  onTyped,
  onProgress,
}: {
  messages: ThreadMessage[];
  pending: boolean;
  farm: AssistantFarm | null;
  latest: string;
  /** The chat is stored, so answers can be rated and regenerated. */
  saved: boolean;
  followUps: string[];
  onAsk: (question: string) => void;
  onRetry: (message: ThreadMessage) => void;
  onRegenerate: () => void;
  onFeedback: (message: ThreadMessage, value: MessageFeedback | null) => void;
  onTyped: (message: ThreadMessage) => void;
  onProgress: () => void;
}) {
  const last = messages[messages.length - 1];
  const typing = messages.some((m) => m.animate);
  const showFollowUps = !pending && !typing && last?.role === "assistant" && !last.error && followUps.length > 0;
  return (
    <div className="space-y-8 pb-6">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <UserMessage key={m.key} message={m} latest={latest} onRetry={m.stopped && i === messages.length - 1 && !pending ? () => onRetry(m) : undefined} />
        ) : (
          <AssistantMessage
            key={m.key}
            message={m}
            latest={latest}
            isLast={i === messages.length - 1}
            canRegenerate={saved && !pending}
            canRate={saved}
            onTyped={() => onTyped(m)}
            onProgress={onProgress}
            onRegenerate={onRegenerate}
            onFeedback={(value) => onFeedback(m, value)}
            onRetry={() => onRetry(m)}
          />
        ),
      )}
      {pending ? (
        <div aria-live="polite">
          <AnswerLabel />
          <p className="flex items-center gap-3 text-sm text-muted-foreground">
            <ThinkingDots />
            <span>{farm ? `Reading ${farm.name}'s probes…` : "Thinking…"}</span>
          </p>
        </div>
      ) : null}
      {showFollowUps ? (
        <div className="duration-200 animate-in fade-in-0 motion-reduce:animate-none">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ask next</p>
          <div className="flex flex-wrap gap-2">
            {followUps.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onAsk(q)}
                className="inline-flex min-h-11 items-center rounded-full border bg-card px-3.5 py-1.5 text-left text-sm text-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-9"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A new chat: a greeting, the farm's state in words, and four prompts to start from. */
export function EmptyState({ farm, onAsk, disabled }: { farm: AssistantFarm | null; onAsk: (question: string) => void; disabled?: boolean }) {
  if (!farm) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <AssistantMark className="size-10" />
        <h2 className="mt-4 font-display text-[28px] leading-tight text-foreground">No farms yet</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Add a farm with soil probes and the assistant can answer questions about it.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col justify-center py-10 sm:py-16">
      <AssistantMark className="size-10" />
      <h2 className="mt-5 font-display text-[28px] leading-tight text-foreground">
        Ask about <span className="text-primary">{farm.name}</span>
      </h2>
      <p className="mt-3 flex items-start gap-2 text-base text-muted-foreground">
        <HealthDot tone={farm.reasonTone} className="mt-2" />
        <span>
          <span className="font-medium text-foreground">{farm.reason}.</span> {farm.headline}
        </span>
      </p>
      {farm.hasReadings ? (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="Suggested questions">
          {farm.prompts.map((p) => (
            <li key={p}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAsk(p)}
                className="group flex h-full w-full items-center justify-between gap-3 rounded-2xl sm:min-h-16 sm:items-start border bg-card p-4 text-left text-sm text-foreground shadow-xs transition-[border-color,background-color,transform] duration-150 hover:border-primary/40 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:translate-y-px disabled:opacity-50 motion-reduce:transition-none"
              >
                <span>{p}</span>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-primary"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 max-w-md text-sm text-muted-foreground">
          The assistant answers from this farm&apos;s probe readings.{" "}
          <Link href="/dashboard/devices" className="font-semibold text-primary hover:underline">
            Connect an ESP32
          </Link>{" "}
          and ask again once it has sent its first reading.
        </p>
      )}
    </div>
  );
}

/** /dashboard/assistant/[id] for a chat that was deleted (or can't be read right now). */
export function MissingChat({ kind, onNew, onRetry }: { kind: "not-found" | "unavailable"; onNew: () => void; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageSquareOff className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-xl font-semibold text-foreground">{kind === "not-found" ? "This chat was deleted" : "Couldn't open this chat"}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {kind === "not-found"
          ? "It may have been deleted on another device, or the link is wrong. Your other chats are in the list."
          : "Chat history is unavailable right now. Try again in a moment, or start a new chat."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {kind === "unavailable" ? (
          <Button variant="outline" className="h-11 rounded-xl px-4 sm:h-9" onClick={onRetry}>
            <RefreshCw aria-hidden="true" /> Try again
          </Button>
        ) : null}
        <Button className="h-11 rounded-xl px-4 sm:h-9" onClick={onNew}>
          <Plus aria-hidden="true" /> New chat
        </Button>
      </div>
    </div>
  );
}

/** While a saved chat loads. */
export function ThreadSkeleton() {
  return (
    <div className="space-y-8 py-8" aria-busy="true" aria-label="Loading the chat">
      <Skeleton className="ml-auto h-11 w-2/3 rounded-2xl" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="ml-auto h-11 w-1/2 rounded-2xl" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
