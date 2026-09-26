"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { FarmPicker } from "@/components/shell/farm-picker";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";

/** An unknown farm id: stay in the app and offer the farms that do exist. */
export default function FarmNotFound() {
  const { farms, switchFarm } = useShell();
  return (
    <div className="yai-enter mx-auto flex max-w-lg flex-col px-4 pt-10 pb-10 sm:px-6 lg:pt-16">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">Farm not found</p>
      <h1 className="mt-2 font-display text-[1.75rem] leading-tight font-semibold tracking-tight">This field is not on our map</h1>
      <p className="mt-2 text-base text-muted-foreground">
        {farms.length > 0
          ? "The link may be old, or the farm belongs to another account. These are your farms:"
          : "The link may be old, or the farm belongs to another account."}
      </p>
      {farms.length > 0 ? (
        <div className="mt-5 rounded-2xl border bg-card p-2 shadow-xs">
          <FarmPicker farms={farms} selectedId={null} onSelect={switchFarm} label="Your farms, ranked by risk" />
        </div>
      ) : null}
      <Button asChild variant="outline" className="mt-5 h-11 self-start sm:h-9 sm:pointer-coarse:h-11">
        <Link href="/dashboard">
          <ArrowLeft aria-hidden="true" />
          Back to Home
        </Link>
      </Button>
    </div>
  );
}
