'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Tooltip } from './Tooltip'

/** Плавающая кнопка «наверх». Появляется после прокрутки вниз (полезно на длинных
 *  списках/курсах). Уважает prefers-reduced-motion. Скрыта при печати. */
export function ScrollToTop({ label = 'Наверх' }: { label?: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
        }}
        className="fixed bottom-5 right-5 z-40 grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink-2 shadow-card transition-colors hover:border-border-strong hover:text-ink print:hidden"
      >
        <ArrowUp size={18} />
      </button>
    </Tooltip>
  )
}
