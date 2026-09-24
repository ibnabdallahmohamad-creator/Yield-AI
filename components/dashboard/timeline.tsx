"use client";

import { ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formatDay, formatShortDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const PLAY_STEP_MS = 140;

function tickIndices(n: number): number[] {
  if (n <= 1) return [0];
  const count = 5;
  return Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1)));
}

function agoLabel(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** 60-day date slider with play, and the Then / Now range for compare mode (omit `onCompareChange` to hide the switch). */
export function Timeline({
  dates,
  dateIndex,
  onDateIndex,
  compare = false,
  onCompareChange,
  thenIndex = 0,
  onThenIndex,
  className,
}: {
  dates: string[];
  dateIndex: number;
  onDateIndex: (index: number) => void;
  compare?: boolean;
  onCompareChange?: (on: boolean) => void;
  thenIndex?: number;
  onThenIndex?: (index: number) => void;
  className?: string;
}) {
  const last = dates.length - 1;
  const [playing, setPlaying] = useState(false);
  const compareId = useId();

  const tick = useEffectEvent(() => {
    if (dateIndex >= last) {
      setPlaying(false);
      return;
    }
    onDateIndex(dateIndex + 1);
  });

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => tick(), PLAY_STEP_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (dateIndex >= last) onDateIndex(compare ? Math.min(last, thenIndex + 1) : 0);
    setPlaying(true);
  };

  const span = dateIndex - thenIndex;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 rounded-full border-primary/30 bg-card text-primary hover:bg-accent"
        onClick={togglePlay}
        aria-label={playing ? "Pause playback" : "Play the timeline"}
        aria-pressed={playing}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </Button>

      <div className="min-w-48 flex-1 pt-1">
        {compare ? (
          <Slider
            min={0}
            max={last}
            step={1}
            minStepsBetweenThumbs={1}
            value={[thenIndex, dateIndex]}
            onValueChange={([then, now]) => {
              if (then !== thenIndex) onThenIndex?.(then);
              if (now !== dateIndex) onDateIndex(now);
            }}
            thumbLabels={["Then (earlier day)", "Now (later day)"]}
            thumbValueText={[formatDay(dates[thenIndex]), formatDay(dates[dateIndex])]}
          />
        ) : (
          <Slider
            min={0}
            max={last}
            step={1}
            value={[dateIndex]}
            onValueChange={([v]) => onDateIndex(v)}
            thumbLabels={["Day shown"]}
            thumbValueText={[formatDay(dates[dateIndex])]}
          />
        )}
        <div className="relative mt-2 h-4 text-[11px] text-muted-foreground tabular" aria-hidden="true">
          {tickIndices(dates.length).map((i, k, all) => (
            <span
              key={i}
              className={cn(
                "absolute whitespace-nowrap",
                k === 0 ? "left-0" : k === all.length - 1 ? "right-0" : "-translate-x-1/2",
              )}
              style={k === 0 || k === all.length - 1 ? undefined : { left: `${(i / last) * 100}%` }}
            >
              {i === last ? "Today" : formatShortDay(dates[i])}
            </span>
          ))}
        </div>
      </div>

      <div className={cn("flex min-w-36 flex-col items-end text-right", !onCompareChange && "ml-auto")} aria-live="polite">
        {compare ? (
          <>
            <span className="inline-flex items-center gap-1 text-sm font-semibold tabular">
              {formatShortDay(dates[thenIndex])}
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {formatShortDay(dates[dateIndex])}
            </span>
            <span className="text-xs text-muted-foreground">
              Then vs now · {span} day{span === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold tabular">{formatDay(dates[dateIndex])}</span>
            <span className="text-xs text-muted-foreground">{agoLabel(last - dateIndex)}</span>
          </>
        )}
      </div>

      {onCompareChange ? (
        <label htmlFor={compareId} className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
          <Switch id={compareId} checked={compare} onCheckedChange={onCompareChange} />
          Compare
        </label>
      ) : null}
    </div>
  );
}
