'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SearchInput } from '@/shared/ui/SearchInput'
import { t, type Lang } from '@/shared/i18n'

export interface SettingsSection {
  id: string
  title: string
  icon: ReactNode
  keywords: string[] // для поиска (по-русски и по-английски)
  content: ReactNode
  danger?: boolean
}

export function SettingsShell({ sections, lang }: { sections: SettingsSection[]; lang: Lang }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(sections[0]?.id ?? '')

  const query = q.trim().toLowerCase()
  const visible = useMemo(
    () =>
      query
        ? sections.filter(
            (s) => s.title.toLowerCase().includes(query) || s.keywords.some((k) => k.toLowerCase().includes(query)),
          )
        : sections,
    [sections, query],
  )

  // Scrollspy: подсветка активной секции по прокрутке.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setActive(vis[0].target.id)
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: 0 },
    )
    visible.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [visible])

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-6 py-8 md:flex-row">
      <aside className="flex-shrink-0 md:sticky md:top-[70px] md:h-fit md:w-[220px]">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder={t('settingsSearchPh', lang)}
          className="mb-3"
          clearLabel={t('clear', lang)}
        />
        <nav className="flex flex-col gap-0.5">
          {sections.map((s) => {
            const shown = visible.some((v) => v.id === s.id)
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                  !shown ? 'pointer-events-none opacity-30' : active === s.id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:text-ink'
                } ${s.danger ? 'text-[var(--danger)]' : ''}`}
              >
                {s.icon} {s.title}
              </a>
            )
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {t('noSettingsFound', lang)}
          </div>
        ) : (
          visible.map((s) => (
            <div key={s.id} id={s.id} className="scroll-mt-[76px]">
              {s.content}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
