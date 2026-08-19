import { FeedListSkeleton } from '@/shared/ui/Skeleton'
import { PAGE } from '@/shared/ui/control'

export default function Loading() {
  return (
    // sf-wait: скелет не показывается первые 250 мс. Листание страниц поиска — это
    // навигация внутрь того же маршрута, то есть скелет мигал на КАЖДОМ нажатии
    // стрелки, хотя данные приходили за сотню миллисекунд.
    <div className="sf-wait flex w-full flex-1 items-stretch">
      <aside className="hidden w-[16.25rem] shrink-0 border-r border-border bg-surface-2 px-3 py-5 lg:block" />
      <section className="min-w-0 flex-1">
        <div className={PAGE}>
          <FeedListSkeleton count={6} className="space-y-3 py-3" />
        </div>
      </section>
    </div>
  )
}
