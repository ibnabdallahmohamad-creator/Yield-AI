"use client";

import { CloudOff, Cpu, Database, House, LogOut, Menu, Radio, Timer } from "lucide-react";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LiveStatus } from "@/hooks/use-live-updates";
import { formatInterval, formatTimeSeconds, initials } from "@/lib/format";
import { READING_INTERVALS_S } from "@/lib/store/types";
import type { DataSource } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LiveEvent {
  farmName: string;
  probes: number;
  at: string;
  simulated: boolean;
}

export interface HeaderUser {
  name: string;
  email: string;
  demo: boolean;
}

const SOURCE: Record<DataSource, { label: string; text: string }> = {
  demo: {
    label: "Demo data",
    text: "The shared demo account shows 8 built-in demo farms with 60 days of readings. Create your own account to connect your ESP32 probes — it starts empty.",
  },
  supabase: { label: "Your farms", text: "Your own farms and probe readings, stored in Supabase." },
  local: { label: "Your farms", text: "Your own farms and probe readings, stored on this server (.data/)." },
};

function SourceBadge({ source, error }: { source: DataSource; error: boolean }) {
  const { label, text } = SOURCE[source];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex h-6 cursor-default items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap ring-1 ring-inset focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            error
              ? "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40"
              : source === "demo"
                ? "bg-sand-200 text-foreground/75 ring-black/5"
                : "bg-risk-low-soft text-risk-low-ink ring-risk-low/25",
          )}
        >
          <Database className="size-3" aria-hidden="true" />
          {error ? "Data unavailable" : label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{error ? "Your farms could not be loaded just now. The page retries on refresh." : text}</TooltipContent>
    </Tooltip>
  );
}

const STATUS_TEXT: Record<LiveStatus, string> = {
  off: "Live updates off",
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

/** How often readings are refreshed (and, for accounts, how often their ESP32s report). */
export function IntervalSelect({
  value,
  onChange,
  pending,
  demo,
  className,
}: {
  value: number;
  onChange: (seconds: number) => void;
  pending?: boolean;
  demo: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={className}>
          <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={pending}>
            <SelectTrigger size="sm" className="h-8 gap-1 rounded-full bg-card pl-2.5 text-[13px] font-semibold" aria-label="Reading interval">
              <Timer className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {READING_INTERVALS_S.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Every {formatInterval(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {demo
          ? "How often the dashboard refreshes the live readings."
          : "How often your ESP32s send a reading and the dashboard refreshes. Devices pick up a change with their next reading."}
      </TooltipContent>
    </Tooltip>
  );
}

type IntervalControl = { value: number; onChange: (seconds: number) => void; pending?: boolean };

function UserMenu({ user, interval }: { user: HeaderUser; interval?: IntervalControl }) {
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
        {interval ? (
          // Phones have no room for the interval control in the header.
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="sm:hidden">
              <Timer /> Every {formatInterval(interval.value)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={String(interval.value)} onValueChange={(v) => interval.onChange(Number(v))}>
                {READING_INTERVALS_S.map((s) => (
                  <DropdownMenuRadioItem key={s} value={String(s)} disabled={interval.pending}>
                    Every {formatInterval(s)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/dashboard/setup">
            <Cpu /> Farms &amp; devices
          </Link>
        </DropdownMenuItem>
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
  sourceError = false,
  weatherOffline,
  title = "Farm dashboard",
  live = false,
  onLiveChange,
  liveStatus = "off",
  lastEvent = null,
  interval,
  onOpenFarms,
  showSetupLink = true,
  className,
}: {
  user: HeaderUser;
  source: DataSource;
  sourceError?: boolean;
  weatherOffline: boolean;
  title?: string;
  live?: boolean;
  /** Omit to hide the live-mode switch. */
  onLiveChange?: (on: boolean) => void;
  liveStatus?: LiveStatus;
  lastEvent?: LiveEvent | null;
  /** Reading interval control (omit to hide). */
  interval?: IntervalControl;
  /** Omit to hide the farm-list button (small screens). */
  onOpenFarms?: () => void;
  showSetupLink?: boolean;
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
        <SourceBadge source={source} error={sourceError} />
        {weatherOffline ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="hidden h-6 items-center gap-1.5 rounded-full bg-sand-200 px-2.5 text-[11.5px] font-semibold text-foreground/75 ring-1 ring-black/5 ring-inset lg:inline-flex"
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
        {interval ? (
          <IntervalSelect value={interval.value} onChange={interval.onChange} pending={interval.pending} demo={user.demo} className="hidden sm:block" />
        ) : null}
        {showSetupLink ? (
          <Button asChild variant="outline" size="sm" className="hidden h-8 rounded-full bg-card md:inline-flex">
            <Link href="/dashboard/setup">
              <Cpu /> Farms &amp; devices
            </Link>
          </Button>
        ) : null}
        <UserMenu user={user} interval={interval} />
      </div>
    </header>
  );
}
