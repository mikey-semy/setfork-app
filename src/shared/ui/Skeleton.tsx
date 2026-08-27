import { cn } from '@/shared/lib/cn'

/** Пульсирующая заглушка под контент (loading-состояния). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-border', className)} />
}

/** Заглушка карточки списка (лента/профиль). */
export function FeedCardSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-3">
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  )
}

/** Список заглушек-карточек. */
export function FeedListSkeleton({ count = 6, className = 'space-y-3' }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </div>
  )
}
