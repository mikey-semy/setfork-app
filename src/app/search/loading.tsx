import { FeedListSkeleton } from '@/shared/ui/Skeleton'

export default function Loading() {
  return (
    <div className="flex w-full flex-1 items-stretch">
      <aside className="hidden w-[260px] shrink-0 border-r border-border bg-surface-2 px-3 py-5 lg:block" />
      <section className="min-w-0 flex-1 px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-[1120px]">
          <FeedListSkeleton count={6} className="space-y-3 py-3" />
        </div>
      </section>
    </div>
  )
}
