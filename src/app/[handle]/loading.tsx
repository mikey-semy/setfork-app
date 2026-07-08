import { FeedListSkeleton, Skeleton } from '@/shared/ui/Skeleton'

export default function Loading() {
  return (
    <div className="w-full px-6 py-8 lg:px-8">
      <div className="mx-auto flex max-w-[980px] flex-col gap-8 md:flex-row">
        <aside className="shrink-0 space-y-4 md:w-[280px]">
          <Skeleton className="h-[180px] w-[180px] rounded-2xl" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
        </aside>
        <section className="min-w-0 flex-1">
          <div className="mb-4 flex gap-5 border-b border-border pb-2.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
          <FeedListSkeleton count={4} />
        </section>
      </div>
    </div>
  )
}
