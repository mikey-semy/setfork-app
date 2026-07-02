import { FeedListSkeleton, Skeleton } from '@/shared/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 items-stretch">
      <aside className="hidden w-[260px] flex-shrink-0 border-r border-border bg-surface-2 px-4 py-5 md:block">
        <Skeleton className="mb-3 h-3 w-16" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-16 rounded-full" />
          ))}
        </div>
      </aside>
      <section className="min-w-0 flex-1 px-6 py-4">
        <div className="mb-4 flex gap-4 border-b border-border pb-2.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <FeedListSkeleton count={6} className="space-y-3 py-3" />
      </section>
    </div>
  )
}
