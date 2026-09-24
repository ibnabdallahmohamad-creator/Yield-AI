import { LogoMark } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";

/** Dashboard skeleton — mirrors the real layout so nothing jumps when data arrives. */
export default function DashboardLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden" aria-busy="true" aria-label="Loading the dashboard">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <LogoMark className="size-7" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-4 hidden h-6 w-24 rounded-full sm:block" />
        <Skeleton className="ml-auto h-8 w-24 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[264px] shrink-0 space-y-2 border-r p-3 xl:block 2xl:w-[308px]">
          <Skeleton className="mb-3 h-3 w-20" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-3 p-4">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="overflow-hidden rounded-2xl border">
            <div className="flex gap-2 border-b p-2">
              <Skeleton className="h-8 w-80" />
              <Skeleton className="h-8 w-64" />
            </div>
            <div className="flex h-[clamp(340px,calc(100dvh_-_340px),560px)] items-center justify-center bg-[repeating-linear-gradient(135deg,var(--sand-100)_0_14px,var(--sand-200)_14px_28px)]">
              <span className="rounded-full bg-card/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
                Loading farms, probes and FAO-56 calculations…
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
        <div className="hidden w-[360px] shrink-0 space-y-3 border-l p-4 lg:block xl:w-[368px] 2xl:w-[440px]">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
