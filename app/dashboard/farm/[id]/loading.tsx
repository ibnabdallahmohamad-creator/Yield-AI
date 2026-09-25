import { Skeleton } from "@/components/ui/skeleton";

/** Farm workspace skeleton: mirrors the header, tabs, KPIs, map and "What to do" so nothing jumps when data arrives. */
export default function FarmLoading() {
  return (
    <div className="px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6" aria-busy="true" aria-label="Loading farm details">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-4 flex gap-6 border-b pb-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-14" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:mt-6 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex h-[max(320px,45vh)] items-center justify-center rounded-2xl border bg-[repeating-linear-gradient(135deg,var(--sand-100)_0_14px,var(--sand-200)_14px_28px)] lg:h-[clamp(360px,calc(100dvh-340px),620px)]">
          <span className="rounded-full bg-card/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">Loading probes and FAO-56 calculations…</span>
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-1.5 pt-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
