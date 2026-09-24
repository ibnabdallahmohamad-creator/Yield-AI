"use client";

import { CloudOff, Database, House, LogOut, Menu, Radio } from "lucide-react";
import Link from "next/link";
import { useId, useTransition } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LiveStatus } from "@/hooks/use-live-updates";
import { formatTimeSeconds, initials } from "@/lib/format";
import type { DataSource } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LiveEvent {
  farmName: string;
  probes: number;
  at: string;
  simulated: boolean;
}

function SourceBadge({ source, fallback }: { source: DataSource; fallback: boolean }) {
  const label = source === "supabase" ? "Supabase" : fallback ? "Demo data · offline" : "Demo data";
  const text =
    source === "supabase"
      ? "Live data from the Supabase database."
      : fallback
        ? "Supabase can't be reached right now, so the built-in demo dataset is shown. Everything keeps working."
        : "Built-in demo dataset: 8 farms in northern Qatar with 60 days of probe readings. Connect Supabase to use your own.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex h-6 cursor-default items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap ring-1 ring-inset focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            source === "supabase" && "bg-risk-low-soft text-risk-low-ink ring-risk-low/25",
            source === "mock" && !fallback && "bg-sand-200 text-foreground/75 ring-black/5",
            source === "mock" && fallback && "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40",
          )}
        >
          <Database className="size-3" aria-hidden="true" />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}

const STATUS_TEXT: Record<LiveStatus, string> = {
  off: "Live mode off",
  connecting: "Connecting…",
  live: "Live",
  retrying: "Reconnecting…",
  "signed-out": "Sign in again for live data",
};

function LiveControl({
  live,
  onLiveChange,
  status,
  lastEvent,
}: {
  live: boolean;
  onLiveChange: (on: boolean) => void;
  status: LiveStatus;
  lastEvent: LiveEvent | null;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {live && lastEvent ? (
        <p className="hidden min-w-0 truncate text-[12px] text-muted-foreground xl:block" aria-live="polite">
          <span className="font-medium text-foreground">{lastEvent.farmName}</span> · {lastEvent.probes} probe
          {lastEvent.probes === 1 ? "" : "s"} · {formatTimeSeconds(lastEvent.at)}
          {lastEvent.simulated ? " · demo feed" : ""}
        </p>
      ) : null}
      <label
        htmlFor={id}
        className={cn(
          "flex h-8 cursor-pointer items-center gap-2 rounded-full border px-2.5 text-[13px] font-semibold select-none",
          live ? "border-risk-low/40 bg-risk-low-soft text-risk-low-ink" : "bg-card",
        )}
        title={STATUS_TEXT[status]}
      >
        <span className="relative flex size-2.5 items-center justify-center" aria-hidden="true">
          {live && status === "live" ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-risk-low opacity-60" />
          ) : null}
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              !live && "bg-muted-foreground/40",
              live && status === "live" && "bg-risk-low",
              live && (status === "connecting" || status === "retrying") && "bg-risk-medium",
              live && status === "signed-out" && "bg-risk-high",
            )}
          />
        </span>
        <Radio className="hidden size-3.5 sm:block" aria-hidden="true" />
        <span>Live</span>
        <Switch id={id} checked={live} onCheckedChange={onLiveChange} className="ml-0.5" aria-describedby={`${id}-status`} />
        <span id={`${id}-status`} className="sr-only">
          {STATUS_TEXT[status]}
        </span>
      </label>
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground ring-offset-2 ring-offset-background transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Account: ${user.name}`}
        >
          {initials(user.name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-semibold">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/">
            <House /> Home page
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault();
            startTransition(() => signOutAction());
          }}
        >
          <LogOut /> {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardHeader({
  user,
  source,
  sourceFallback,
  weatherOffline,
  title = "Farm dashboard",
  live = false,
  onLiveChange,
  liveStatus = "off",
  lastEvent = null,
  onOpenFarms,
  className,
}: {
  user: { name: string; email: string };
  source: DataSource;
  sourceFallback: boolean;
  weatherOffline: boolean;
  title?: string;
  live?: boolean;
  /** Omit to hide the live-mode switch. */
  onLiveChange?: (on: boolean) => void;
  liveStatus?: LiveStatus;
  lastEvent?: LiveEvent | null;
  /** Omit to hide the farm-list button (small screens). */
  onOpenFarms?: () => void;
  className?: string;
}) {
  return (
    <header className={cn("z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4", className)}>
      {onOpenFarms ? (
        <Button variant="ghost" size="icon" className="size-9 xl:hidden" onClick={onOpenFarms} aria-label="Show farms">
          <Menu className="size-5" />
        </Button>
      ) : null}
      <Link href="/" className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none" aria-label="Yield AI home">
        <Logo markClassName="size-7" />
      </Link>
      <span className="hidden h-5 w-px bg-border md:block" aria-hidden="true" />
      <p className="hidden text-[14px] font-semibold text-muted-foreground md:block">{title}</p>
      <div className="hidden items-center gap-2 sm:flex">
        <SourceBadge source={source} fallback={sourceFallback} />
        {weatherOffline ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="inline-flex h-6 items-center gap-1.5 rounded-full bg-sand-200 px-2.5 text-[11.5px] font-semibold text-foreground/75 ring-1 ring-black/5 ring-inset"
              >
                <CloudOff className="size-3" aria-hidden="true" /> Weather offline
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Open-Meteo can&apos;t be reached, so ET₀ is estimated with FAO-56 Hargreaves from air temperature.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        {onLiveChange ? <LiveControl live={live} onLiveChange={onLiveChange} status={liveStatus} lastEvent={lastEvent} /> : null}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
