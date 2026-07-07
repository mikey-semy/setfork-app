import Link from 'next/link'
import { GitFork, Star } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

// GitHub-стайл граф активности (contribution-хитмап). Без year — скользящее
// окно ~год; с year — календарный год (Jan–Dec) + селектор годов.
const LEVEL = ['bg-border', 'bg-ok/25', 'bg-ok/50', 'bg-ok/75', 'bg-ok']
const level = (c: number): number => (c === 0 ? 0 : c <= 2 ? 1 : c <= 4 ? 2 : c <= 6 ? 3 : 4)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function ActivityGraph({
  contributions,
  starsReceived,
  forksReceived,
  lang,
  year,
  years = [],
  base,
}: {
  contributions: { date: string; count: number }[]
  starsReceived: number
  forksReceived: number
  lang: Lang
  /** Выбранный календарный год; undefined = скользящее окно (последний год). */
  year?: number
  /** Доступные годы (регистрация…сейчас), новые сверху; пусто = без селектора. */
  years?: number[]
  /** База профиля для ссылок селектора (например `/mike`). */
  base?: string
}) {
  const map = new Map(contributions.map((c) => [c.date, c.count]))
  const total = contributions.reduce((s, c) => s + c.count, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Диапазон сетки. С year — ВЕСЬ календарный год Jan1–Dec31 (даже текущий: будущие
  // дни и «хвосты» соседних лет остаются пустыми клетками, но ширина — целый год).
  // Без year — скользящее окно ~52 недели до сегодня.
  let gridEnd: Date
  let start: Date
  if (year != null) {
    gridEnd = new Date(year, 11, 31)
    start = new Date(year, 0, 1)
    start.setDate(start.getDate() - start.getDay())
  } else {
    gridEnd = new Date(today)
    start = new Date(gridEnd)
    start.setDate(start.getDate() - 364)
    start.setDate(start.getDate() - start.getDay()) // выравниваем на начало недели (вс)
  }

  const weeks: { date: string; count: number; blank: boolean }[][] = []
  const cur = new Date(start)
  while (cur <= gridEnd) {
    const week: { date: string; count: number; blank: boolean }[] = []
    for (let d = 0; d < 7; d++) {
      const ds = iso(cur)
      // Пустая (без квадратика) клетка: будущее ИЛИ день не из выбранного года.
      const blank = cur > today || (year != null && cur.getFullYear() !== year)
      week.push({ date: ds, count: map.get(ds) ?? 0, blank })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }
  const fmtMonth = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short' })
  let lastLabel = -3
  const months = weeks.map((w, i) => {
    // Метку месяца ставим над колонкой, в которую попало 1-е число месяца — тогда
    // ведущий огрызок недели из декабря прошлого года не подписывается «Dec».
    const first = w.find((c) => new Date(c.date).getDate() === 1)
    if (!first) return null
    const dt = new Date(first.date)
    if (year != null && dt.getFullYear() !== year) return null // хвост соседнего года
    if (i - lastLabel < 3) return null // не впритык к предыдущей метке
    lastLabel = i
    return fmtMonth.format(dt)
  })

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
        <span>
          <b className="text-ink">{total}</b> {t('contributions', lang)}{' '}
          {year != null ? (lang === 'ru' ? `за ${year}` : `in ${year}`) : t('inLastYear', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star size={13} className="text-muted" /> <b className="text-ink">{starsReceived}</b> {t('starsReceived', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <GitFork size={13} className="text-muted" /> <b className="text-ink">{forksReceived}</b> {t('forksReceived', lang)}
        </span>
      </div>

      {/* Селектор года (как GitHub): «Последний год» + годы регистрации…сейчас. */}
      {years.length > 0 && base && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Link
            href={base}
            className={`rounded-md border px-2 py-0.5 text-[12px] ${year == null ? 'border-accent bg-[var(--accent-soft)] text-accent' : 'border-border text-ink-2 hover:border-border-strong'}`}
          >
            {lang === 'ru' ? 'Последний год' : 'Last year'}
          </Link>
          {years.map((y) => (
            <Link
              key={y}
              href={`${base}?year=${y}`}
              className={`rounded-md border px-2 py-0.5 font-mono text-[12px] ${year === y ? 'border-accent bg-[var(--accent-soft)] text-accent' : 'border-border text-ink-2 hover:border-border-strong'}`}
            >
              {y}
            </Link>
          ))}
        </div>
      )}

      {/* Колонка дней недели вынесена ИЗ скролл-контейнера: при горизонтальном скролле
          она остаётся видимой слева, скроллятся только месяцы и квадратики. */}
      <div className="flex">
        {/* Дни недели слева (Mon/Wed/Fri), как у GitHub. */}
        <div className="flex w-[26px] shrink-0 flex-col gap-1 bg-surface">
          {/* spacer под строку месяцев (её высота = 10px, leading-none) */}
          <div className="h-[10px]" />
          <div className="flex flex-col gap-[3px] text-[9px] leading-[11px] text-muted">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="h-[11px]">
                {d === 1 ? (lang === 'ru' ? 'пн' : 'Mon') : d === 3 ? (lang === 'ru' ? 'ср' : 'Wed') : d === 5 ? (lang === 'ru' ? 'пт' : 'Fri') : ''}
              </div>
            ))}
          </div>
        </div>
        {/* direction:rtl на скролл-контейнере = старт прокрутки СПРАВА (видны последние
            дни), без JS; внутренний ltr возвращает нормальный порядок недель. Скролл —
            тонкий полупрозрачный (.scroll-thin), не пугает на узких экранах. */}
        <div className="scroll-thin min-w-0 flex-1 overflow-x-auto pb-1" style={{ direction: 'rtl' }}>
          <div className="inline-flex flex-col gap-1" style={{ direction: 'ltr' }}>
            <div className="flex gap-[3px] text-[10px] leading-none text-muted">
              {months.map((m, i) => (
                <div key={i} className="w-[11px] whitespace-nowrap">
                  {m ?? ''}
                </div>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((cell, di) =>
                    cell.blank ? (
                      <div key={di} className="h-[11px] w-[11px]" />
                    ) : (
                      <div
                        key={di}
                        title={`${cell.count} ${t('contributions', lang)} · ${cell.date}`}
                        className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL[level(cell.count)]}`}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
        <span>{t('less', lang)}</span>
        {LEVEL.map((cls, i) => (
          <span key={i} className={`h-[11px] w-[11px] rounded-[2px] ${cls}`} />
        ))}
        <span>{t('more', lang)}</span>
      </div>
    </div>
  )
}
