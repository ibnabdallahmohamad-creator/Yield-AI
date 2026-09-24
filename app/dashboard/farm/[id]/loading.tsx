import { LogoMark } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";

/** Farm details skeleton — mirrors the real layout so nothing jumps when data arrives. */
export default function FarmLoading() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-label="Loading farm details">
      <div className="flex h-14 items-center gap-3 border-b px-4">
        <LogoMark className="size-7" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-4 hidden h-6 w-24 rounded-full sm:block" />
        <Skeleton className="ml-auto size-8 rounded-full" />
      </div>
      <div className="mx-auto grid max-w-[1720px] gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="overflow-hidden rounded-2xl border">
            <div className="flex gap-2 border-b p-2">
              <Skeleton className="h-8 w-80" />
              <Skeleton className="h-8 w-64" />
            </div>
            <div className="flex h-[clamp(320px,calc(100dvh_-_360px),520px)] items-center justify-center bg-[repeating-linear-gradient(135deg,var(--sand-100)_0_14px,var(--sand-200)_14px_28px)]">
              <span className="rounded-full bg-card/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
                Loading probes, trends and FAO-56 calculations…
              </span>
            </div>
            <div className="flex items-center gap-4 border-t p-3">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-2 flex-1" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[84px] rounded-xl" />
            ))}
          </div>
        </div>
        <div className="hidden space-y-3 lg:block">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
