"use client";

import { CalendarDays } from "lucide-react";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { dotTone } from "@/components/assistant/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { asOfLabel } from "@/lib/assistant";
import { formatWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssistantFarm } from "./types";

/** How many past days the "as of" picker offers. */
const AS_OF_DAYS = 30;

/** The farm the answers are about (required: every question is grounded on one farm). */
export function FarmSelect({
  farms,
  value,
  onChange,
  className,
}: {
  farms: AssistantFarm[];
  value: string | null;
  onChange: (id: string) => void;
  className?: string;
}) {
  const current = farms.find((f) => f.id === value) ?? null;
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Farm the answers are about"
        className={cn("h-11 min-w-0 rounded-xl border-transparent bg-transparent px-2.5 font-medium hover:bg-muted sm:h-9", className)}
      >
        <SelectValue placeholder="Pick a farm">
          {current ? (
            <span className="flex min-w-0 items-center gap-2">
              <HealthDot tone={dotTone(current)} />
              <span className="truncate">{current.name}</span>
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-h-[min(420px,var(--radix-select-content-available-height))] w-72">
        {farms.map((f) => (
          <SelectItem key={f.id} value={f.id} className="py-2">
            <span className="flex min-w-0 items-start gap-2.5">
              <HealthDot tone={dotTone(f)} className="mt-1.5" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{f.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {f.crop} · {f.reason}
                </span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Optional "as of" day: answer about the numbers on an earlier day. Default: today. */
export function AsOfSelect({
  dates,
  value,
  onChange,
  className,
}: {
  dates: string[];
  value: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  const latest = dates[dates.length - 1] ?? value;
  const recent = dates.slice(-AS_OF_DAYS).reverse();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Answer using the numbers as of"
        className={cn("h-11 rounded-xl border-transparent bg-transparent px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:h-9", className)}
      >
        <CalendarDays className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">as of</span>
        <span className="font-medium text-foreground">{asOfLabel(value, latest)}</span>
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-h-[min(360px,var(--radix-select-content-available-height))]">
        {recent.map((d) => (
          <SelectItem key={d} value={d}>
            <span className="flex w-40 items-center justify-between gap-3">
              <span>{asOfLabel(d, latest)}</span>
              <span className="text-xs text-muted-foreground">{formatWeekday(d)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
