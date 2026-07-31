'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SearchField } from '@/shared/ui/SearchField'
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

  // Scrollspy по позиции: активна — последняя секция, чей верх пересёк линию ~110px.
  // Надёжнее IntersectionObserver: любая секция (в т.ч. предпоследняя, как «Расход ИИ»)
  // получает active. На самом низу страницы — последняя.
  useEffect(() => {
    const ids = visible.map((s) => s.id)
    const compute = () => {
      const line = 110
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top - line <= 1) current = id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = ids[ids.length - 1]
      if (current) setActive(current)
    }
    compute()
    window.addEventListener('scroll', compute, { passive: true })
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute)
      window.removeEventListener('resize', compute)
    }
  }, [visible])

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-6 py-8 md:flex-row">
      {/* top = высота шапки (57) + верхний паддинг (py-8 = 32) → без «прыжка» к шапке при скролле. */}
      <aside className="shrink-0 md:sticky md:top-[89px] md:h-fit md:w-[220px]">
        <SearchField
          value={q}
          onValueChange={setQ}
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
                } ${s.danger ? 'text-danger' : ''}`}
              >
                {s.icon} {s.title}
              </a>
            )
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        {visible.length === 0 ? (
          <EmptyState hint={t('noSettingsFound', lang)} />
        ) : (
          visible.map((s) => (
            <div key={s.id} id={s.id} className="scroll-mt-[76px]">
              {s.content}
            </div>
          ))
        )}
        {/* Спейсер: чтобы последние секции могли доскроллиться до линии активации. */}
        {visible.length > 1 && <div aria-hidden className="h-[45vh]" />}
      </div>
    </div>
  )
}
