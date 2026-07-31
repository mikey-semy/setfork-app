'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Terminal, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

// Промо-слот сайдбара (место под «свою рекламу», как Copilot-карточка у GitHub).
// Одна активная кампания; id — для повторного показа после смены кампании.
const PROMO = {
  id: 'mcp-2026-07',
  href: '/settings#mcp', // якорь прямо к секции MCP (scroll-mt в SettingsShell)
  en: { badge: 'New', title: 'Run lists from your IDE', cta: 'Set up MCP access' },
  ru: { badge: 'Новое', title: 'Прогоняй списки прямо из IDE', cta: 'Настроить MCP-доступ' },
}

export function PromoCard({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const c = ru ? PROMO.ru : PROMO.en
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(`sf-promo-${PROMO.id}`) === '1')
    } catch {
      setHidden(false)
    }
  }, [])

  const dismiss = () => {
    setHidden(true)
    try {
      window.localStorage.setItem(`sf-promo-${PROMO.id}`, '1')
    } catch {
      // ignore
    }
  }

  if (hidden) return null
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-linear-to-br from-(--accent-soft) to-surface p-3.5">
      <button type="button" onClick={dismiss} className="absolute right-2 top-2 rounded-md p-1 text-muted hover:text-ink" aria-label="Dismiss">
        <X size={13} />
      </button>
      <span className="inline-block rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-semibold text-white">{c.badge}</span>
      <div className="mt-2 flex items-start gap-2">
        <Terminal size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="text-[0.875rem] font-semibold leading-snug text-ink">{c.title}</div>
      </div>
      <Link
        href={PROMO.href}
        className="mt-3 block rounded-md border border-border bg-surface py-1.5 text-center text-[0.78125rem] font-semibold text-ink hover:border-border-strong"
      >
        {c.cta}
      </Link>
    </div>
  )
}
