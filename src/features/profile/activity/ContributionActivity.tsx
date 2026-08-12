import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/IconButton'
import { Skeleton } from '@/shared/ui/Skeleton'
import { fullDate, monthYearLong } from '@/shared/lib/date'
import { ActivityTopicItem } from './ActivityTopicItem'
import { parseDayKey, type ActivityTopic, type DayKey } from './types'

/** Лента активности (Contribution activity, как GitHub): темы работ с иконками
 *  на полоске таймлайна — версии, созданные списки, задачи, предложения.
 *  Окно ленты — месяц, а клик по клетке календаря сужает его до одного дня. */
export function ContributionActivity({
  topics,
  month,
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
  /** Месяц ленты ключом `YYYY-MM`. */
  month: string
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
  return (
    <section className="mt-6">
      <div className="mb-3 text-[1rem] font-semibold text-ink">{t('profile.activity.title', lang)}</div>
      {/* Высота ряда одна в обоих состояниях: месяц со стрелками и день с «Весь
          месяц». Резерв на телефоне — 48px: тач-цель 44 плюс отступ до линии,
          иначе ряд вырастал на выборе дня и заголовок ленты дёргался. */}
      <div className="mb-4 flex h-7 items-center justify-between gap-2 border-b border-border pb-1 pointer-coarse:h-12">
        <span key={day ?? month} className="sf-fade-in min-w-0 truncate text-[0.78125rem] font-semibold uppercase tracking-wide text-muted">
          {day ? fullDate(parseDayKey(day) ?? day, lang) : monthYearLong(parseDayKey(`${month}-01`) ?? `${month}-01`, lang)}
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
              <MonthStep href={nav.prev} label={t('profile.activity.prevMonth', lang)}>
                <ChevronLeft size={13} />
              </MonthStep>
              <MonthStep href={nav.next} label={t('profile.activity.nextMonth', lang)}>
                <ChevronRight size={13} />
              </MonthStep>
            </span>
          )
        )}
      </div>

      {/* Живая область СТАБИЛЬНА: скринридер объявляет изменения только внутри
          уже зарегистрированной области, а пересоздавай мы её на каждую фазу —
          и приехавшие темы, и сообщение об ошибке остались бы непрочитанными.
          Ключ с анимацией висит на вложенном блоке. */}
      <div aria-busy={loading} aria-live="polite">
        <div key={`${day ?? month}:${loading}:${failed}`} className="sf-rise-in">
          {failed ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[0.8125rem] text-danger">{t('profile.activity.loadFailed', lang)}</p>
              <Button size="xs" onClick={onRetry}>
                {t('tryAgain', lang)}
              </Button>
            </div>
          ) : loading ? (
            <LoadingTopics />
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
      </div>
    </section>
  )
}

/** Шаг по месяцам: доступный — ссылка, недоступный — та же кнопка выключенной. */
function MonthStep({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  return (
    <IconButton size="xs" label={label} href={href ?? undefined} disabled={!href}>
      {children}
    </IconButton>
  )
}

/** Заглушка на время подгрузки дня — лента не должна мигать пустотой. */
function LoadingTopics() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
