'use client'

import { useEffect, useRef, useState } from 'react'
import { fill, plural, type Lang } from '@/shared/i18n'
import { fullDate } from '@/shared/lib/date'
import { DayTip, type TipAnchor } from './DayTip'
import { LEVEL, level, type Calendar, type Cell } from './grid'
import { dayKey, parseDayKey, type DayKey } from './types'

// Сетка клеток календаря: наведение показывает день, клик фильтрует ленту под
// графом. Данные считает grid.ts, что делать с выбранным днём — решает родитель.

/** Стрелки двигают фокус: вверх/вниз — соседний день, влево/вправо — соседняя неделя. */
const STEP: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }

/** Подпись дня: «5 вкладов 12 августа 2026» — и в подсказке, и для скринридера. */
function dayLabel(cell: { date: string; count: number }, lang: Lang): string {
  const date = fullDate(parseDayKey(cell.date) ?? cell.date, lang)
  return cell.count === 0
    ? fill('profile.activity.noContributionsOn', lang, { date })
    : fill('profile.activity.contributionsOn', lang, { n: cell.count, contributions: plural(cell.count, 'contributions', lang), date })
}

export function ContributionGrid({
  calendar,
  lang,
  selected,
  onSelect,
}: {
  calendar: Calendar
  lang: Lang
  /** Выбранный день (фильтр ленты) или null. */
  selected: DayKey | null
  /** Клик по клетке; тот же день вторым кликом снимает фильтр — решает родитель. */
  onSelect: (day: DayKey) => void
}) {
  // ОДИН тултип на весь хитмап: ячеек ~370, и вешать на каждую отдельный Radix-инстанс
  // расточительно. Рисует его DayTip — в портале, потому что контейнер сетки режет
  // по обеим осям; сетка лишь говорит, над какой клеткой и что показать.
  const [tip, setTip] = useState<TipAnchor | null>(null)
  // Roving tabindex: в таб-порядок попадает ОДНА клетка, остальные достижимы
  // стрелками (иначе 370 табстопов на пути к тому, что под графом).
  const [roving, setRoving] = useState<DayKey | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Табстоп ищем среди клеток С ВКЛАДАМИ: пустые больше не кнопки, и указывать
  // на сегодняшний пустой день значило бы, что в календарь вообще не войти табом.
  const last = calendar.weeks.flat().filter((c) => !c.blank && c.count > 0).at(-1)
  const tabStop = roving ?? selected ?? last?.date ?? null

  const showTip = (el: HTMLElement, cell: Cell) => {
    const box = el.getBoundingClientRect()
    setTip({ text: dayLabel(cell, lang), x: box.left + box.width / 2, top: box.top, bottom: box.bottom })
  }

  // Подсказка прицелена в координаты окна: поехала прокрутка (страницы или самой
  // сетки) или размер — она повиснет не над своей клеткой, поэтому убираем её.
  // Слушаем в фазе перехвата: прокрутка контейнера наверх не всплывает.
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('resize', hide)
    }
  }, [tip])

  // Клавиши ходят по дням С ВКЛАДАМИ: пустые клетки выбирать нечего, поэтому они
  // и не кнопки — шагаем дальше в ту же сторону, пока не найдём следующую живую.
  const moveFocus = (from: DayKey, days: number) => {
    const at = parseDayKey(from)
    if (!at) return
    for (let i = 0; i < calendar.weeks.length * 7; i++) {
      at.setDate(at.getDate() + days)
      const next = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${dayKey(at)}"]`)
      if (next) {
        setRoving(dayKey(at))
        next.focus()
        return
      }
    }
  }

  return (
    <div className="relative inline-flex flex-col gap-1 p-0.5" style={{ direction: 'ltr' }} ref={gridRef}>
      {/* key по дню: новая клетка = новая подсказка, и переворот вниз считается заново. */}
      {tip && <DayTip key={tip.text} anchor={tip} />}
      {/* Строка месяцев ровно h-3.5 (= spacer колонки дней), текст прижат вниз к клеткам. */}
      <div className="flex h-3.5 items-end gap-[0.1875rem] text-caption leading-none text-muted">
        {calendar.months.map((m, i) => (
          <div key={i} className="w-3 whitespace-nowrap">
            {m ?? ''}
          </div>
        ))}
      </div>
      <div className="flex gap-[0.1875rem]">
        {calendar.weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[0.1875rem]">
            {week.map((cell, di) =>
              cell.blank ? (
                <div key={di} className="h-3 w-3" />
              ) : cell.count === 0 ? (
                // День без вкладов фильтровать нечем: подсказку показываем, кнопкой не делаем.
                <div
                  key={di}
                  className={`h-3 w-3 rounded-xs transition-opacity duration-(--dur-base) ${LEVEL[0]} ${selected ? 'opacity-30' : 'opacity-100'}`}
                  onMouseEnter={(e) => showTip(e.currentTarget, cell)}
                  onMouseLeave={() => setTip(null)}
                />
              ) : (
                <button
                  key={di}
                  // ui-parity-ok: клетка календаря активности — 10px квадрат в сетке, любой отступ ломает шаг сетки
                  type="button"
                  data-date={cell.date}
                  aria-label={dayLabel(cell, lang)}
                  aria-pressed={selected === cell.date}
                  tabIndex={tabStop === cell.date ? 0 : -1}
                  onClick={() => onSelect(cell.date)}
                  onKeyDown={(e) => {
                    const step = STEP[e.key]
                    if (!step) return
                    e.preventDefault()
                    moveFocus(cell.date, step)
                  }}
                  onMouseEnter={(e) => showTip(e.currentTarget, cell)}
                  onMouseLeave={() => setTip(null)}
                  onFocus={(e) => showTip(e.currentTarget, cell)}
                  onBlur={() => setTip(null)}
                  // Выбранный день остаётся в полную силу и с кольцом, остальные
                  // уходят в фон — видно, какой срез сейчас показывает лента.
                  // Кольцо БЕЗ offset: с зазором оно у крайних клеток вылезало за
                  // окно прокрутки и срезалось. Место под сами 2px даёт p-0.5 сетки.
                  className={`h-3 w-3 rounded-xs touch-manipulation transition-[opacity,box-shadow] duration-(--dur-base) ${LEVEL[level(cell.count, calendar.scale)]} ${
                    selected === cell.date ? 'opacity-100 ring-2 ring-accent' : selected ? 'opacity-30 hover:opacity-60' : 'opacity-100'
                  }`}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
