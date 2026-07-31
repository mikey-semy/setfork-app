'use client'

import { useState } from 'react'
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
  showRolling = true,
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
  /** Показывать пилюлю «Последний год» (скользящее окно). Ложь → только годы. */
  showRolling?: boolean
  /** База профиля для ссылок селектора (например `/mike`). */
  base?: string
}) {
  // ОДИН тултип на весь хитмап: ячеек ~370, и вешать на каждую отдельный Radix-инстанс
  // расточительно. Стиль — как у shared/ui/Tooltip, позиция считается от ячейки.
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null)
  const map = new Map(contributions.map((c) => [c.date, c.count]))
  const total = contributions.reduce((s, c) => s + c.count, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Диапазон сетки. С year — календарный год: прошлый рисуем целиком Jan1–Dec31,
  // текущий — только до сегодня (чтобы правый край сетки = «сейчас», а не пустой
  // хвост будущих месяцев). Без year — скользящее окно ~52 недели до сегодня.
  let gridEnd: Date
  let start: Date
  if (year != null) {
    gridEnd = year === today.getFullYear() ? new Date(today) : new Date(year, 11, 31)
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
  const fmtMonth = new Intl.DateTimeFormat(lang, { month: 'short' })
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
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2">
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

      {/* Селектор года (как GitHub): «Последний год» + годы регистрации…сейчас.
          Прячем целиком, если переключать не на что (нет rolling и один год). */}
      {years.length > 0 && base && (showRolling || years.length > 1) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {showRolling && (
            <Link
              href={base}
              className={`rounded-md border px-2 py-0.5 text-[0.78125rem] ${year == null ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:border-border-strong'}`}
            >
              {lang === 'ru' ? 'Последний год' : 'Last year'}
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
        {/* Дни недели слева (Mon/Wed/Fri), как у GitHub. Высота spacer'а ЖЁСТКО равна
            высоте строки месяцев (h-[0.8125rem]), а каждая подпись центрируется в h-[0.6875rem]
            строке — той же, что и квадратик-ячейка, — иначе метки уезжают на пол-клетки. */}
        <div className="flex w-[1.625rem] shrink-0 flex-col gap-1 bg-surface">
          <div className="h-[0.8125rem]" />
          <div className="flex flex-col gap-[0.1875rem] text-[0.6875rem] text-muted">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="flex h-[0.6875rem] items-center leading-none">
                {d === 1 ? (lang === 'ru' ? 'пн' : 'Mon') : d === 3 ? (lang === 'ru' ? 'ср' : 'Wed') : d === 5 ? (lang === 'ru' ? 'пт' : 'Fri') : ''}
              </div>
            ))}
          </div>
        </div>
        {/* direction:rtl на скролл-контейнере = старт прокрутки СПРАВА (видны последние
            дни), без JS; внутренний ltr возвращает нормальный порядок недель. Скролл —
            тонкий полупрозрачный (.scroll-thin), не пугает на узких экранах. */}
        <div className="scroll-thin min-w-0 flex-1 overflow-x-auto pb-1" style={{ direction: 'rtl' }}>
          <div className="relative inline-flex flex-col gap-1" style={{ direction: 'ltr' }}>
            {tip && (
              <div
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[0.6875rem] leading-snug text-ink shadow-card"
                style={{ left: tip.left, top: tip.top }}
              >
                {tip.text}
              </div>
            )}
            {/* Строка месяцев ровно h-[0.8125rem] (= spacer колонки дней), текст прижат вниз к клеткам. */}
            <div className="flex h-[0.8125rem] items-end gap-[0.1875rem] text-[0.6875rem] leading-none text-muted">
              {months.map((m, i) => (
                <div key={i} className="w-[0.6875rem] whitespace-nowrap">
                  {m ?? ''}
                </div>
              ))}
            </div>
            <div className="flex gap-[0.1875rem]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[0.1875rem]">
                  {week.map((cell, di) =>
                    cell.blank ? (
                      <div key={di} className="h-[0.6875rem] w-[0.6875rem]" />
                    ) : (
                      <div
                        key={di}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget
                          setTip({
                            text: `${cell.count} ${t('contributions', lang)} · ${cell.date}`,
                            left: el.offsetLeft + el.offsetWidth / 2,
                            top: el.offsetTop - 4,
                          })
                        }}
                        onMouseLeave={() => setTip(null)}
                        className={`h-[0.6875rem] w-[0.6875rem] rounded-[2px] ${LEVEL[level(cell.count)]}`}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
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
