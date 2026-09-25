"use client";

import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { InfoTip } from "@/components/dashboard/info-tip";
import { cn } from "@/lib/utils";

const MAX_CHARS = 1000;
/** About eight lines; longer questions scroll inside the box. */
const MAX_HEIGHT_PX = 220;

/**
 * The question box: grows with the text, Enter sends, Shift+Enter adds a line, and the send button
 * turns into Stop while an answer is on its way.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  pending,
  disabled,
  placeholder,
  note,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  pending: boolean;
  disabled?: boolean;
  placeholder: string;
  /** The line under the box (what the answers are based on). */
  note: React.ReactNode;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? ownRef;
  const canSend = value.trim().length > 0 && !pending && !disabled;

  // Grow with the text (reset first so it also shrinks).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value, ref]);

  return (
    <form
      className="mx-auto w-full max-w-[720px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs transition-shadow duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <label htmlFor="assistant-composer" className="sr-only">
          Your question
        </label>
        <textarea
          id="assistant-composer"
          ref={ref}
          rows={1}
          value={value}
          maxLength={MAX_CHARS}
          disabled={disabled}
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="scrollbar-thin max-h-[220px] min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50 sm:min-h-10 sm:py-2"
        />
        {pending ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop answering"
            title="Stop"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity duration-150 hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-10"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-[opacity,background-color] duration-150 hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:bg-muted disabled:text-muted-foreground sm:size-10"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 px-2 text-center text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{note}</span>
        <InfoTip label="Where do answers come from?">
          Answers use this farm&apos;s soil probe readings, weather and saved advice. They come from the Yield AI model; if it can&apos;t be
          reached, from Claude; and without either, from the built-in agronomy engine (FAO-56 and FAO-29 rules). Each answer says
          which one wrote it. Check anything important with your agronomist.
        </InfoTip>
        {value.length > MAX_CHARS - 100 ? (
          <span className={cn("shrink-0 tabular-nums", value.length >= MAX_CHARS && "font-medium text-foreground")}>
            {value.length}/{MAX_CHARS}
          </span>
        ) : null}
      </div>
    </form>
  );
}
