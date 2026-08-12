import Link from 'next/link'
import { GitFork, Star } from 'lucide-react'
import { fill, plural, t, type Lang } from '@/shared/i18n'
import { buildCalendar, LEVEL } from './grid'
import { ContributionGrid } from './ContributionGrid'
import type { DayKey } from './types'

// GitHub-стайл граф активности (contribution-хитмап). Без year — скользящее
// окно ~год; с year — календарный год (Jan–Dec) + селектор годов.

/** Дни недели, которые подписываем слева (пн, ср, пт) — как у GitHub. */
const LABELED_WEEKDAYS = [1, 3, 5]

export function ActivityGraph({
  contributions,
  starsReceived,
  forksReceived,
  lang,
  year,
  years = [],
  showRolling = true,
  base,
  selected,
  onSelect,
}: {
  contributions: { date: string; count: number }[]
  starsReceived: number
  forksReceived: number
  lang: Lang
  /** Выбранный календарный год; undefined = скользящее окно (последний год). */
  year?: number
  /** Доступные годы (регистрация…сейчас), новые сверху; пусто = без селектора. */
  years?: number[]
  /** Показывать пилюлю «Последний год» (скользящее окно). Ложь → только годы. */
  showRolling?: boolean
  /** База профиля для ссылок селектора (например `/mike`). */
  base?: string
  /** День, по которому отфильтрована лента под графом. */
  selected: DayKey | null
  onSelect: (day: DayKey) => void
}) {
  const calendar = buildCalendar({ contributions, year, lang })
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'short' })
  const firstWeek = calendar.weeks[0]

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2">
        <span>
          <b className="text-ink">{calendar.total}</b> {plural(calendar.total, 'contributions', lang)}{' '}
          {year != null ? fill('profile.activity.inYear', lang, { year }) : t('inLastYear', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star size={13} className="text-muted" /> <b className="text-ink">{starsReceived}</b> {t('starsReceived', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <GitFork size={13} className="text-muted" /> <b className="text-ink">{forksReceived}</b> {t('forksReceived', lang)}
        </span>
      </div>

      {/* Селектор года (как GitHub): «Последний год» + годы регистрации…сейчас.
          Прячем целиком, если переключать не на что (нет rolling и один год). */}
      {years.length > 0 && base && (showRolling || years.length > 1) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {showRolling && (
            <Link
              href={base}
              className={`rounded-md border px-2 py-0.5 text-[0.78125rem] ${year == null ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:border-border-strong'}`}
            >
              {t('profile.activity.lastYear', lang)}
            </Link>
          )}
          {years.map((y) => (
            <Link
              key={y}
              href={`${base}?year=${y}`}
              className={`rounded-md border px-2 py-0.5 font-mono text-[0.78125rem] ${year === y ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:border-border-strong'}`}
            >
              {y}
            </Link>
          ))}
        </div>
      )}

      {/* Колонка дней недели вынесена ИЗ скролл-контейнера: при горизонтальном скролле
          она остаётся видимой слева, скроллятся только месяцы и квадратики. */}
      <div className="flex">
        {/* Дни недели слева (пн/ср/пт), как у GitHub. Высота spacer'а ЖЁСТКО равна
            высоте строки месяцев (h-[0.8125rem]), а каждая подпись центрируется в h-[0.6875rem]
            строке — той же, что и квадратик-ячейка, — иначе метки уезжают на пол-клетки. */}
        <div className="flex w-[1.625rem] shrink-0 flex-col gap-1 bg-surface">
          <div className="h-[0.8125rem]" />
          <div className="flex flex-col gap-[0.1875rem] text-[0.6875rem] text-muted">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="flex h-[0.6875rem] items-center leading-none">
                {/* Название дня даёт Intl по языку профиля, а не наш словарь: так
                    третий язык получает свои «пн/ср/пт» без единой правки кода. */}
                {LABELED_WEEKDAYS.includes(d) && firstWeek ? weekday.format(new Date(firstWeek[d].date)) : ''}
              </div>
            ))}
          </div>
        </div>
        {/* direction:rtl на скролл-контейнере = старт прокрутки СПРАВА (видны последние
            дни), без JS; внутренний ltr возвращает нормальный порядок недель. Скролл —
            тонкий полупрозрачный (.scroll-thin), не пугает на узких экранах. */}
        <div className="scroll-thin min-w-0 flex-1 overflow-x-auto pb-1" style={{ direction: 'rtl' }}>
          <ContributionGrid calendar={calendar} lang={lang} selected={selected} onSelect={onSelect} />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[0.6875rem] text-muted">
        <span>{t('less', lang)}</span>
        {LEVEL.map((cls, i) => (
          <span key={i} className={`h-[0.6875rem] w-[0.6875rem] rounded-[2px] ${cls}`} />
        ))}
        <span>{t('more', lang)}</span>
      </div>
    </div>
  )
}
