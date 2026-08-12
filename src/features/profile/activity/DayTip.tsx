'use client'

import { useLayoutEffect, useRef, useState } from 'react'
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
  // Узел портала запоминаем один раз при создании и под защитой: document на
  // сервере нет, а сюда, хоть и попадают только кликом, лезть незащищённо нельзя.
  const [host] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : document.body))
  const ref = useRef<HTMLDivElement>(null)

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
  }, [anchor])

  if (!host) return null

  // Появление — ТОЛЬКО прозрачностью: transform у подсказки занят центрированием
  // и переворотом, а .sf-pop-in анимирует именно его — подсказка прыгала бы вбок.
  return createPortal(
    <div
      ref={ref}
      aria-hidden
      className={`sf-fade-in pointer-events-none fixed z-50 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[0.6875rem] leading-snug text-ink shadow-card ${place ? '' : 'opacity-0'}`}
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
