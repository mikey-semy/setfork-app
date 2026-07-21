'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Tooltip } from './Tooltip'

/**
 * Плавающий «назад» — спутник верхней back-ссылки на длинных страницах (редактор
 * длинного списка и т.п.): к верхней ссылке приходилось скроллить обратно
 * (фидбек владельца). Появляется, когда верх ушёл за экран; висит слева-внизу —
 * зеркально ScrollToTop (справа-внизу), в углу, где не перекрывает контент и
 * не уезжает за экран на мобильных.
 */
export function FloatingBack({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null
  return (
    <Tooltip label={label}>
      <Link
        href={href}
        aria-label={label}
        className="fixed bottom-5 left-5 z-40 grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink-2 shadow-card transition-colors hover:border-border-strong hover:text-ink print:hidden"
      >
        <ArrowLeft size={18} />
      </Link>
    </Tooltip>
  )
}
