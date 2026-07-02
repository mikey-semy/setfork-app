import { Skeleton } from '@/shared/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6">
      <Skeleton className="mb-5 h-6 w-72" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
        <div className="hidden w-[300px] flex-shrink-0 lg:block">
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
