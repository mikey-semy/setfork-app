import { FeedListSkeleton, Skeleton } from '@/shared/ui/Skeleton'

// Соответствует витрине /explore (discovery): без сайдбара, ~1080, темы + лента.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 py-8">
      <Skeleton className="mb-6 h-7 w-40" />
      <Skeleton className="mb-3 h-3 w-28" />
      <div className="mb-8 flex flex-wrap gap-2">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-16 rounded-full" />
        ))}
      </div>
      <Skeleton className="mb-2 h-4 w-24" />
      <FeedListSkeleton count={5} />
    </div>
  )
}
