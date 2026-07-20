'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// Единый таб-бар под шапкой (GitHub-стиль) — ОДИН источник правды для профиля,
// страницы списка, Explore и любых будущих разделов. Активная вкладка подчёркнута
// ПЕРЕЕЗЖАЮЩЕЙ полоской.
//
// Плавность «везде»: SPA-переходы Next не перегружают страницу, но между РАЗНЫМИ
// маршрутами (вкладки списка) компонент ремоунтится. Поэтому последняя позиция
// полоски хранится на уровне модуля (переживает ремоунт в том же JS-контексте):
// первый кадр рисуем на старом месте, затем rAF → переезд к новой вкладке.
const lastPos = new Map<string, { left: number; width: number }>()

export function TabNav({
  children,
  maxWidthClass = 'max-w-[1180px]',
  scope = 'default',
  center = false,
}: {
  children: React.ReactNode
  maxWidthClass?: string
  /** Ключ памяти позиции: табы одного раздела (напр. 'list') анимируются между маршрутами. */
  scope?: string
  /** Центрировать вкладки (витрина Explore); по умолчанию слева (GitHub-стиль). */
  center?: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(() => lastPos.get(scope) ?? null)

  useEffect(() => {
    const nav = ref.current
    const el = nav?.querySelector<HTMLElement>('[data-active="true"]')
    if (!nav || !el) {
      setBar(null)
      lastPos.delete(scope)
      return
    }
    const next = { left: el.offsetLeft, width: el.offsetWidth }
    lastPos.set(scope, next)
    // rAF: первый кадр успевает отрисоваться со старой позицией → CSS-transition едет.
    const raf = requestAnimationFrame(() =>
      setBar((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next)),
    )
    return () => cancelAnimationFrame(raf)
  })

  return (
    <div className="border-b border-border">
      {/* justify-center-safe (= `safe center`), а НЕ обычный justify-center: когда табы
          шире экрана (мобильный), обычное центрирование уводит первый таб за левый край
          в НЕДОСКРОЛЛИВАЕМУЮ зону — слева край не видно и достать его нельзя. `safe`
          центрирует, пока влезает, а при переполнении ведёт себя как start (прижимает
          влево), и ряд нормально листается. */}
      <nav ref={ref} className={`no-scrollbar relative mx-auto flex w-full gap-1 overflow-x-auto px-4 text-[14px] ${center ? 'justify-center-safe' : ''} ${maxWidthClass}`}>
        {children}
        {bar && (
          <span
            aria-hidden
            className="absolute bottom-0 h-[2px] rounded-full bg-accent transition-all duration-200 ease-out"
            style={{ left: bar.left, width: bar.width }}
          />
        )}
      </nav>
    </div>
  )
}

export function TabItem({
  href,
  on,
  icon,
  label,
  count,
}: {
  href: string
  on: boolean
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <Link
      href={href}
      data-active={on || undefined}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 ${
        on ? 'font-semibold text-ink' : 'font-medium text-ink-2 hover:text-ink'
      }`}
    >
      <span className={on ? 'text-ink' : 'text-muted'}>{icon}</span> {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-surface-2 px-1.5 text-[11.5px] text-ink-2">{count}</span>
      )}
    </Link>
  )
}
