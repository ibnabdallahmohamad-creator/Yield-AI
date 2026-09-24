"use client";

import { RotateCcw, Sprout } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Friendly fallback if the dashboard fails to render — never shows the raw error. */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <Sprout className="size-6" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-xl font-semibold">The dashboard hit a snag</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Your farm data is safe. Try loading it again — if it keeps happening, the demo data will take over automatically.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw /> Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Home page</Link>
        </Button>
      </div>
    </main>
  );
}
