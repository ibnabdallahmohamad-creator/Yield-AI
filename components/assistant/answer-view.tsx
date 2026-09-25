"use client";

/**
 * An assistant answer split into sections (lib/ai/sections.ts — plain parsing, no AI): the direct
 * answer first, then Warnings, Insights, Recommendations, Forecast, Economics, Crop plan, Data gaps and
 * Sources, each with its own layout. Works the same for the fine-tuned model's JSON, the report JSON,
 * and Markdown answers from the Claude fallback or the offline engine.
 */
import {
  BookOpen,
  CalendarDays,
  CircleHelp,
  Coins,
  ExternalLink,
  FileText,
  Lightbulb,
  ListChecks,
  Microscope,
  Sprout,
  TriangleAlert,
  Wheat,
} from "lucide-react";
import { Markdown } from "@/components/dashboard/markdown";
import type { AnswerSection, BadgeTone, ParsedAnswer, SectionItem, SectionKind } from "@/lib/ai/sections";
import { cn } from "@/lib/utils";

const ICON: Record<SectionKind, React.ComponentType<{ className?: string }>> = {
  summary: FileText,
  insights: Lightbulb,
  why: Microscope,
  warnings: TriangleAlert,
  do_now: ListChecks,
  recommendations: ListChecks,
  forecast: CalendarDays,
  economics: Coins,
  harvest: Wheat,
  crop_plan: Sprout,
  sources: BookOpen,
  data_gaps: CircleHelp,
  other: FileText,
};

const BADGE: Record<BadgeTone, string> = {
  critical: "bg-risk-high-soft text-risk-high-ink ring-risk-high/25",
  warning: "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40",
  watch: "bg-muted text-muted-foreground ring-border",
  high: "bg-risk-high-soft text-risk-high-ink ring-risk-high/25",
  medium: "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40",
  low: "bg-muted text-muted-foreground ring-border",
  good: "bg-risk-low-soft text-risk-low-ink ring-risk-low/25",
  avoid: "bg-risk-high-soft text-risk-high-ink ring-risk-high/25",
  neutral: "bg-muted text-muted-foreground ring-border",
};

const ITEM_BORDER: Partial<Record<BadgeTone, string>> = {
  critical: "border-l-risk-high",
  warning: "border-l-risk-medium",
  watch: "border-l-border",
};

function Badge({ badge }: { badge: NonNullable<SectionItem["badge"]> }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-semibold ring-1 ring-inset", BADGE[badge.tone])}>{badge.label}</span>
  );
}

function Item({ item, index, ordered, warning }: { item: SectionItem; index: number; ordered?: boolean; warning?: boolean }) {
  const border = warning && item.badge ? ITEM_BORDER[item.badge.tone] : undefined;
  return (
    <li className={cn("flex gap-3", warning && "rounded-lg border border-l-4 bg-card px-3 py-2.5", border)}>
      {ordered ? (
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary tabular" aria-hidden="true">
          {index + 1}
        </span>
      ) : !warning ? (
        <span className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
      ) : null}
      <div className="min-w-0 flex-1">
        {item.title || item.badge || item.meta ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.badge ? <Badge badge={item.badge} /> : null}
            {item.title ? (
              item.href ? (
                <a href={item.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  {item.title}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : (
                <span className="font-semibold text-foreground">{item.title}</span>
              )
            ) : null}
            {item.meta ? <span className="text-sm text-muted-foreground">{item.meta}</span> : null}
          </div>
        ) : null}
        {item.detail ? <Markdown text={item.detail} className="mt-0.5 space-y-1 text-muted-foreground" /> : null}
        {item.cites?.length ? <p className="mt-0.5 text-xs text-muted-foreground">Sources: {item.cites.join(", ")}</p> : null}
      </div>
    </li>
  );
}

function Section({ section }: { section: AnswerSection }) {
  const Icon = ICON[section.kind];
  const quiet = section.kind === "sources" || section.kind === "data_gaps";
  const body = (
    <div className="space-y-3">
      {section.text ? <Markdown text={section.text} /> : null}
      {section.rows?.length ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 sm:grid-cols-[max-content_minmax(0,1fr)]">
          {section.rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0">
                <span className="font-semibold text-foreground">{r.value}</span>
                {r.detail ? <span className="block text-sm text-muted-foreground">{r.detail}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {section.items?.length ? (
        <ul className={cn(section.kind === "warnings" ? "space-y-2" : "space-y-2.5")}>
          {section.items.map((item, i) => (
            <Item key={i} item={item} index={i} ordered={section.ordered} warning={section.kind === "warnings"} />
          ))}
        </ul>
      ) : null}
    </div>
  );
  if (quiet) {
    return (
      <details className="group rounded-lg border px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-muted-foreground marker:hidden">
          <Icon className="size-4" aria-hidden="true" />
          {section.title}
          <span className="font-normal">({section.items?.length ?? 1})</span>
        </summary>
        <div className="mt-2 text-sm">{body}</div>
      </details>
    );
  }
  return (
    <section aria-label={section.title}>
      <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground uppercase">
        <Icon className={cn("size-4", section.kind === "warnings" ? "text-risk-high-ink" : "text-primary")} aria-hidden="true" />
        {section.title}
      </h4>
      {body}
    </section>
  );
}

/** The parsed answer. `visible` limits how many sections show (the staged reveal while it "types"). */
export function AnswerView({ answer, visible, className }: { answer: ParsedAnswer; visible?: number; className?: string }) {
  const sections = visible == null ? answer.sections : answer.sections.slice(0, Math.max(0, visible - 1));
  return (
    <div className={cn("space-y-5", className)}>
      {answer.summary && (visible == null || visible > 0) ? <Markdown text={answer.summary} /> : null}
      {sections.map((s, i) => (
        <Section key={`${s.kind}-${i}`} section={s} />
      ))}
    </div>
  );
}
