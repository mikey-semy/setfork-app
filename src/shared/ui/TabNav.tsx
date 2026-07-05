'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'

// Единый таб-бар под шапкой (GitHub-стиль) — ОДИН источник правды для профиля,
// страницы списка, Explore и любых будущих разделов. Активная вкладка подчёркнута
// ПЕРЕЕЗЖАЮЩЕЙ полоской (плавный transition при переключении на той же странице).

export function TabNav({
  children,
  maxWidthClass = 'max-w-[1180px]',
}: {
  children: React.ReactNode
  maxWidthClass?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)

  // Позиция полоски = позиция активного таба ([data-active="true"]).
  useLayoutEffect(() => {
    const nav = ref.current
    const el = nav?.querySelector<HTMLElement>('[data-active="true"]')
    if (!nav || !el) {
      setBar(null)
      return
    }
    const left = el.offsetLeft
    const width = el.offsetWidth
    setBar((prev) => (prev && prev.left === left && prev.width === width ? prev : { left, width }))
  })

  return (
    <div className="border-b border-border">
      <nav ref={ref} className={`no-scrollbar relative mx-auto flex w-full gap-1 overflow-x-auto px-4 text-[14px] ${maxWidthClass}`}>
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
