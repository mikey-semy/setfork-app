import Link from 'next/link'
import { GitFork, Star } from 'lucide-react'
import { fill, plural, t, type Lang } from '@/shared/i18n'
import { weekdayShort } from '@/shared/lib/date'
import { fmtCount, fmtNumber } from '@/shared/lib/count'
import { buildCalendar, LEVEL } from './grid'
import { ContributionGrid } from './ContributionGrid'
import { parseDayKey, type DayKey } from './types'
import { cardClass } from '@/shared/ui/card-style'

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
  today,
  base,
  selected,
  onSelect,
}: {
  contributions: { date: string; count: number }[]
  starsReceived: number
  forksReceived: number
  lang: Lang
  /** Показанный календарный год; по умолчанию текущий. */
  year?: number
  /** Доступные годы (регистрация…сейчас), новые сверху; пусто = без селектора. */
  years?: number[]
  /** «Сегодня» по часам сервера: правый край сетки и год заголовка. */
  today: DayKey
  /** База профиля для ссылок селектора (например `/mike`). */
  base?: string
  /** День, по которому отфильтрована лента под графом. */
  selected: DayKey | null
  onSelect: (day: DayKey) => void
}) {
  const now = parseDayKey(today) ?? undefined
  const calendar = buildCalendar({ contributions, year, lang, now })
  const firstWeek = calendar.weeks[0]

  return (
    <div className={cardClass()}>
      <div key={year} className="animate-sf-fade sf-slow mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-ink-2">
        <span>
          <b className="text-ink">{fmtNumber(calendar.total, lang)}</b> {plural(calendar.total, 'contributions', lang)}{' '}
          {fill('profile.activity.inYear', lang, { year: year ?? now?.getFullYear() ?? '' })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star size={13} className="text-muted" /> <b className="text-ink">{fmtCount(starsReceived)}</b> {t('starsReceived', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <GitFork size={13} className="text-muted" /> <b className="text-ink">{fmtCount(forksReceived)}</b> {t('forksReceived', lang)}
        </span>
      </div>

      {/* Селектор года: только годы регистрации…сейчас, новые слева. Пилюли
          «Последний год» нет — текущий год и есть последний (решение владельца
          12.08). Прячем селектор целиком, если переключать не на что. */}
      {years.length > 1 && base && (
        <div className="scroll-thin -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {years.map((y) => (
            <Link
              key={y}
              // Текущий год адресуется базой профиля: у «сейчас» один канонический адрес.
              href={y === years[0] ? base : `${base}?year=${y}`}
              className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-body-sm ${year === y ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2 hover:border-border-strong'}`}
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
            высоте строки месяцев (h-3.5), а каждая подпись центрируется в h-3
            строке — той же, что и квадратик-ячейка, — иначе метки уезжают на пол-клетки. */}
        <div className="flex w-6.5 shrink-0 flex-col gap-1 bg-surface">
          <div className="h-3.5" />
          <div className="flex flex-col gap-[0.1875rem] text-caption text-muted">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="flex h-3 items-center leading-none">
                {/* Название дня даёт Intl по языку профиля, а не наш словарь: так
                    третий язык получает свои «пн/ср/пт» без единой правки кода. */}
                {LABELED_WEEKDAYS.includes(d) && firstWeek ? weekdayShort(parseDayKey(firstWeek[d].date) ?? firstWeek[d].date, lang) : ''}
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

      <div className="mt-2 flex items-center justify-end gap-1 text-caption text-muted">
        <span>{t('less', lang)}</span>
        {LEVEL.map((cls, i) => (
          <span key={i} className={`h-3 w-3 rounded-xs ${cls}`} />
        ))}
        <span>{t('more', lang)}</span>
      </div>
    </div>
  )
}
