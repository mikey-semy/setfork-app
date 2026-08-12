import Link from 'next/link'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { fullDate, monthYearLong } from '@/shared/lib/date'
import { ActivityTopicItem } from './ActivityTopicItem'
import type { ActivityTopic, DayKey } from './types'

/** Лента активности (Contribution activity, как GitHub): темы работ с иконками
 *  на полоске таймлайна — версии, созданные списки, задачи, предложения.
 *  Окно ленты — месяц, а клик по клетке календаря сужает его до одного дня. */
export function ContributionActivity({
  topics,
  monthStart,
  day,
  handle,
  lang,
  nav,
  loading = false,
  failed = false,
  onReset,
  onRetry,
}: {
  topics: ActivityTopic[]
  monthStart: Date
  /** Выбранный день или null — тогда показываем месяц целиком. */
  day: DayKey | null
  handle: string
  lang: Lang
  nav?: { prev: string | null; next: string | null }
  loading?: boolean
  /** Активность дня не доехала — говорим об этом и даём повторить. */
  failed?: boolean
  onReset: () => void
  onRetry: () => void
}) {
  const navBtn = 'grid h-6 w-6 place-items-center rounded-md border border-border text-muted hover:text-ink'

  return (
    <section className="mt-6">
      <div className="mb-3 text-[1rem] font-semibold text-ink">{t('profile.activity.title', lang)}</div>
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-1">
        <span className="min-w-0 truncate text-[0.78125rem] font-semibold uppercase tracking-wide text-muted">
          {day ? fullDate(day, lang) : monthYearLong(monthStart, lang)}
        </span>
        {/* Пока лента сужена до дня, стрелки месяцев уводили бы не туда: на их
            месте — выход из фильтра, как и открывает его календарь. */}
        {day ? (
          <Button size="xs" variant="ghost" onClick={onReset} className="shrink-0">
            <X size={13} /> {t('profile.activity.wholeMonth', lang)}
          </Button>
        ) : (
          nav &&
          (nav.prev || nav.next) && (
            <span className="flex shrink-0 items-center gap-1">
              {nav.prev ? (
                <Link href={nav.prev} className={navBtn} aria-label={t('profile.activity.prevMonth', lang)}>
                  <ChevronLeft size={13} />
                </Link>
              ) : (
                <span className={`${navBtn} opacity-40`}>
                  <ChevronLeft size={13} />
                </span>
              )}
              {nav.next ? (
                <Link href={nav.next} className={navBtn} aria-label={t('profile.activity.nextMonth', lang)}>
                  <ChevronRight size={13} />
                </Link>
              ) : (
                <span className={`${navBtn} opacity-40`}>
                  <ChevronRight size={13} />
                </span>
              )}
            </span>
          )
        )}
      </div>

      <div aria-busy={loading} aria-live="polite">
        {failed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[0.8125rem] text-danger">{t('profile.activity.loadFailed', lang)}</p>
            <Button size="xs" onClick={onRetry}>
              {t('tryAgain', lang)}
            </Button>
          </div>
        ) : loading ? (
          <Skeleton />
        ) : topics.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">{t(day ? 'profile.activity.emptyDay' : 'profile.activity.emptyMonth', lang)}</p>
        ) : (
          /* Полоска таймлайна проходит по центру кружков (14px = половина w-7) и
             обрывается у первого и последнего, а не тянется через всю секцию. */
          <ol className="relative flex flex-col gap-5 before:absolute before:bottom-3 before:left-[0.875rem] before:top-3 before:w-px before:bg-border">
            {topics.map((topic) => (
              <ActivityTopicItem key={topic.kind} topic={topic} handle={handle} lang={lang} />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

/** Заглушка на время подгрузки дня — лента не должна мигать пустотой. */
function Skeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex animate-pulse gap-3">
          <span className="h-7 w-7 shrink-0 rounded-full bg-surface-2" />
          <span className="mt-2 h-3 w-2/3 rounded bg-surface-2" />
        </div>
      ))}
    </div>
  )
}
