"use client";

import {
  CloudSun,
  Droplets,
  Eye,
  FlaskConical,
  Gauge,
  Info,
  ListChecks,
  Search,
  Sparkles,
  Sprout,
  TriangleAlert,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { Markdown } from "@/components/dashboard/markdown";
import type { AnswerSection, SectionKind } from "@/lib/ai/sections";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<SectionKind, { icon: LucideIcon; tone: string }> = {
  summary: { icon: Sparkles, tone: "text-primary bg-primary/10" },
  diagnosis: { icon: Search, tone: "text-[oklch(0.45_0.1_250)] bg-[oklch(0.94_0.03_250)]" },
  actions: { icon: ListChecks, tone: "text-risk-low-ink bg-risk-low-soft" },
  irrigation: { icon: Droplets, tone: "text-[oklch(0.45_0.12_240)] bg-[oklch(0.94_0.035_240)]" },
  salinity: { icon: Waves, tone: "text-[oklch(0.5_0.13_55)] bg-[oklch(0.95_0.04_75)]" },
  nutrients: { icon: FlaskConical, tone: "text-[oklch(0.45_0.12_145)] bg-[oklch(0.94_0.04_145)]" },
  crop: { icon: Sprout, tone: "text-primary bg-accent" },
  weather: { icon: CloudSun, tone: "text-[oklch(0.5_0.11_220)] bg-[oklch(0.95_0.03_220)]" },
  risk: { icon: TriangleAlert, tone: "text-risk-high-ink bg-risk-high-soft" },
  monitoring: { icon: Eye, tone: "text-[oklch(0.45_0.08_300)] bg-[oklch(0.95_0.025_300)]" },
  data: { icon: Gauge, tone: "text-foreground/70 bg-muted" },
  other: { icon: Info, tone: "text-foreground/70 bg-muted" },
};

/** Sections truncated to the first `count` characters of their bodies (for the typing effect). */
export function revealSections(sections: AnswerSection[], count: number): AnswerSection[] {
  const out: AnswerSection[] = [];
  let left = count;
  for (const s of sections) {
    if (left <= 0) break;
    out.push(left >= s.body.length ? s : { ...s, body: s.body.slice(0, left) });
    left -= s.body.length;
  }
  return out;
}

/** The text the typing effect walks through: every body, back to back. */
export const sectionsText = (sections: AnswerSection[]) => sections.map((s) => s.body).join("");

/**
 * An answer split into titled sections (lib/ai/sections.ts). `compact` for chat bubbles; the
 * full variant lays sections out as cards.
 */
export function AnswerSections({
  sections,
  compact = false,
  className,
  typing = false,
}: {
  sections: AnswerSection[];
  compact?: boolean;
  className?: string;
  /** Show a caret after the last visible character. */
  typing?: boolean;
}) {
  const card = (s: AnswerSection, i: number, last: boolean) => {
    const { icon: Icon, tone } = KIND_STYLE[s.kind];
    return (
      <section
        key={`${i}-${s.title}`}
        aria-label={s.title}
        className={cn(compact ? "space-y-1" : "mb-3 break-inside-avoid rounded-xl border bg-card p-3.5 shadow-xs")}
      >
        <h4 className={cn("flex items-center gap-2 font-semibold", compact ? "text-[12.5px]" : "text-[13.5px]")}>
          <span className={cn("flex shrink-0 items-center justify-center rounded-md", compact ? "size-5" : "size-6", tone)} aria-hidden="true">
            <Icon className={compact ? "size-3" : "size-3.5"} />
          </span>
          {s.title}
        </h4>
        <div className={cn(compact ? "pl-7" : "mt-2 text-[13.5px] leading-relaxed", typing && last && "yai-caret")}>
          <Markdown text={s.body} />
        </div>
      </section>
    );
  };

  if (compact) {
    return <div className={cn("space-y-3", className)}>{sections.map((s, i) => card(s, i, i === sections.length - 1))}</div>;
  }
  // Full layout: the summary on top, the rest in balanced columns, the action list at the end.
  const indexed = sections.map((s, i) => ({ s, i }));
  const top = indexed.filter(({ s }) => s.kind === "summary");
  const bottom = indexed.filter(({ s }) => s.kind === "actions");
  const middle = indexed.filter(({ s }) => s.kind !== "summary" && s.kind !== "actions");
  const lastIndex = sections.length - 1;
  return (
    <div className={className}>
      {top.map(({ s, i }) => card(s, i, i === lastIndex))}
      {middle.length ? <div className="gap-3 md:columns-2">{middle.map(({ s, i }) => card(s, i, i === lastIndex))}</div> : null}
      {bottom.map(({ s, i }) => card(s, i, i === lastIndex))}
    </div>
  );
}
