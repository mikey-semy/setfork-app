'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SideNav } from '@/shared/ui/SideNav'
import { t, type Lang } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'

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

  // Зазор тот же, что в оболочке админки: 16px по вертикали (мобила), 32px по
  // горизонтали (md+). 32px между свёрнутым меню и содержимым на телефоне —
  // пустая полоса в пол-экрана.
  return (
    <div className={`${PAGE} flex flex-col gap-4 md:flex-row md:gap-8`}>
      {/* top = высота шапки (57) + верхний паддинг рамки (py-6 = 24) → без «прыжка» к шапке при скролле. */}
      <aside className="shrink-0 md:sticky md:top-[5.0625rem] md:h-fit md:w-[13.75rem]">
        <SideNav
          mobileLabel={t('settings', lang)}
          search={{ value: q, onChange: setQ, placeholder: t('settingsSearchPh', lang), clearLabel: t('clear', lang) }}
          groups={[
            {
              items: sections.map((s) => ({
                key: s.id,
                href: `#${s.id}`,
                label: s.title,
                icon: s.icon,
                active: active === s.id,
                dimmed: !visible.some((v) => v.id === s.id),
                danger: s.danger,
                onClick: () => setActive(s.id),
              })),
            },
          ]}
        />
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        {visible.length === 0 ? (
          <EmptyState hint={t('noSettingsFound', lang)} />
        ) : (
          visible.map((s) => (
            <div key={s.id} id={s.id} className="scroll-mt-[4.75rem]">
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
