'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Подсказка над клеткой календаря. Живёт в портале и позиционируется от окна:
// сетка лежит в контейнере с overflow-x, а он режет и по вертикали, и подсказка
// над верхним рядом клеток пряталась за его границей.

/** Куда целимся: центр клетки и её края по вертикали, в координатах окна. */
export interface TipAnchor {
  text: string
  x: number
  top: number
  bottom: number
}

/** Зазор до края окна, px. */
const EDGE = 8

/** Зазор между клеткой и подсказкой, px. */
const GAP = 6

/** Куда в итоге встала подсказка (посчитано по её реальному размеру). */
interface Place {
  left: number
  top: number
  below: boolean
}

export function DayTip({ anchor }: { anchor: TipAnchor }) {
  // Первый проход — измерительный: подсказку надо отрисовать, чтобы узнать её
  // размер, поэтому до расчёта она прозрачна и в бой идёт уже с готовым местом.
  const [place, setPlace] = useState<Place | null>(null)
  // Узел портала берём в эффекте, а не прямо в разметке: document на сервере нет,
  // и чтение его при рендере — мина, даже если сейчас сюда попадают только с клика.
  const [host, setHost] = useState<HTMLElement | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setHost(document.body), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    // Горизонталь: если вылезла за окно — двигаем внутрь на недостающее.
    const shift = box.left < EDGE ? EDGE - box.left : box.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - box.right : 0
    // Вертикаль: сверху может не быть места (верхний ряд клеток, прокрученная
    // страница) — тогда переворачиваем под клетку, как все всплывашки.
    const below = box.top < EDGE
    setPlace({ left: anchor.x + shift, top: below ? anchor.bottom + GAP : anchor.top - GAP, below })
    // host в зависимостях: до него измерять нечего, портала ещё нет.
  }, [anchor, host])

  if (!host) return null

  return createPortal(
    <div
      ref={ref}
      aria-hidden
      className={`pointer-events-none fixed z-50 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[0.6875rem] leading-snug text-ink shadow-card ${place ? '' : 'opacity-0'}`}
      style={{
        left: place?.left ?? anchor.x,
        top: place?.top ?? anchor.top - GAP,
        transform: place?.below ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
      }}
    >
      {anchor.text}
    </div>,
    host,
  )
}
