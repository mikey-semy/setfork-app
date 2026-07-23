'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Tooltip } from './Tooltip'

/** Плавающая кнопка «наверх». Появляется после прокрутки вниз (полезно на длинных
 *  списках/курсах). Уважает prefers-reduced-motion. Скрыта при печати. */
export function ScrollToTop({ label = 'Наверх' }: { label?: string }) {
  const [show, setShow] = useState(false)
  // На страницах с липким полем ввода (чат генерации) кнопка в правом нижнем углу
  // налезала на кнопку отправки (фидбек владельца). Фикс-отступ 86px не спасал —
  // композер с чипами/многострочным вводом выше. Меряем РЕАЛЬНУЮ высоту бара и
  // садимся ровно над ним (+16px зазор). ResizeObserver — на рост поля при вводе.
  const [barH, setBarH] = useState(0)

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>('[data-sticky-input]')
      setBarH(el ? el.offsetHeight : 0)
    }
    const onScroll = () => {
      setShow(window.scrollY > 600)
      measure()
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    const el = document.querySelector<HTMLElement>('[data-sticky-input]')
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measure) : null
    if (el && ro) ro.observe(el)
    return () => {
      window.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
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
        style={barH ? { bottom: barH + 16 } : undefined}
        className={`fixed right-5 z-40 grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink-2 shadow-card transition-colors hover:border-border-strong hover:text-ink print:hidden ${barH ? '' : 'bottom-5'}`}
      >
        <ArrowUp size={18} />
      </button>
    </Tooltip>
  )
}
