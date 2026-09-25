"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Accessible name when the label is terse (e.g. "N"). */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

/** Single-choice segmented control (arrow keys move between options). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
  className,
}: {
  /** Pass "" to show no active option (e.g. when another group holds the selection). */
  value: T | "";
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-sand-200/70 p-0.5 ring-1 ring-black/5 ring-inset", className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          title={o.title}
          disabled={o.disabled}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none hover:bg-card/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm [&_svg]:size-3.5 [&_svg]:shrink-0",
            size === "sm" ? "h-6.5 min-w-7 px-2 text-[12px]" : "h-11 px-3 text-sm sm:h-8 sm:px-2.5 sm:pointer-coarse:h-11",
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
