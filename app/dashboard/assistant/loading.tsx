import { Skeleton } from "@/components/ui/skeleton";

/** Assistant skeleton (full screen, no shell): chats sidebar, context bar, thread and composer. */
export default function AssistantLoading() {
  return (
    <div className="flex min-h-dvh bg-background" aria-busy="true" aria-label="Loading the assistant">
      <div className="hidden w-[272px] shrink-0 flex-col gap-3 border-r bg-sidebar p-3 lg:flex">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="mt-4 h-3 w-16" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <Skeleton className="h-8 w-40 rounded-xl" />
          <Skeleton className="h-8 w-28 rounded-xl" />
        </div>
        <div className="mx-auto w-full max-w-[720px] flex-1 space-y-3 px-4 pt-24">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="mx-auto w-full max-w-[720px] px-3 pb-3 sm:px-4">
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
