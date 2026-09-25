import { Skeleton } from "@/components/ui/skeleton";

/** Plan skeleton: header with the view switch, "This week" and the irrigation column. */
export default function InsightsLoading() {
  return (
    <div className="px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6" aria-busy="true" aria-label="Loading the plan">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-full sm:ml-auto sm:h-9 sm:w-[28rem]" />
      </div>
      <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-4 h-3 w-24" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2 border-t pt-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-5 sm:p-6">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
