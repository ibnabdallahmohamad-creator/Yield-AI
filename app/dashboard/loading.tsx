import { Skeleton } from "@/components/ui/skeleton";

/** Home skeleton (inside the shell): greeting, headline and chips, then the farm table beside the map. */
export default function DashboardLoading() {
  return (
    <div className="px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8" aria-busy="true" aria-label="Loading your farms">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-2 h-9 w-72 max-w-full sm:h-11" />
      <Skeleton className="mt-3 h-5 w-[36rem] max-w-full" />
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-32 rounded-full" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 sm:px-5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="divide-y border-t">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Skeleton className="size-2.5 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-44 max-w-full" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="hidden h-4 w-40 md:block" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex h-[360px] items-center justify-center rounded-2xl border bg-[repeating-linear-gradient(135deg,var(--sand-100)_0_14px,var(--sand-200)_14px_28px)] sm:h-[440px] xl:h-auto">
          <span className="rounded-full bg-card/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">Loading farms, probes and FAO-56 calculations…</span>
        </div>
      </div>
    </div>
  );
}
