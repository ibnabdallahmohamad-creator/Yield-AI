"use client";

import { Cpu, House, LogOut } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";

/**
 * The account menu. `header`: an avatar button (phones and tablets). `sidebar`: the avatar with the
 * name and email beside it when the sidebar is wide.
 */
export function UserMenu({ user, variant = "header" }: { user: { name: string; email: string }; variant?: "header" | "sidebar" }) {
  const [pending, startTransition] = useTransition();
  const avatar = (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground ring-offset-2 ring-offset-background transition hover:opacity-90">
      {initials(user.name)}
    </span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <button
            type="button"
            className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none aria-expanded:bg-sidebar-accent/70"
            aria-label={`Account: ${user.name}`}
          >
            {avatar}
            <span className="hidden min-w-0 flex-1 xl:block xl:group-data-[collapsed=true]/shell:hidden">
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full focus-visible:outline-none sm:size-10 [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-ring"
            aria-label={`Account: ${user.name}`}
          >
            {avatar}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={variant === "sidebar" ? "right" : "bottom"} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-semibold">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/devices">
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
