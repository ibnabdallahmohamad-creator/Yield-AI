"use client";

import { ArrowLeft, RotateCcw, Sprout } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Friendly fallback if a dashboard page fails to render — never shows the raw error. Sits inside the app shell. */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <Sprout className="size-6" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-xl font-semibold">This page hit a snag</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Your farm data is safe. Try loading it again — if it keeps happening, the demo data will take over automatically.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()} className="h-11 sm:h-9 sm:pointer-coarse:h-11">
          <RotateCcw aria-hidden="true" /> Try again
        </Button>
        <Button variant="outline" asChild className="h-11 sm:h-9 sm:pointer-coarse:h-11">
          <Link href="/dashboard">
            <ArrowLeft aria-hidden="true" /> Back to Home
          </Link>
        </Button>
      </div>
    </div>
  );
}
