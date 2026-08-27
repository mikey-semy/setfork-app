'use client'

import { useEffect, useMemo, useState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import type { SettingsSection } from '@/features/settings/SettingsShell'
import { AdminNav, type AdminNavGroup } from './AdminNav'

/**
 * ОБОЛОЧКА /admin: боковое меню плюс секции настроек инстанса.
 *
 * Было: горизонтальный ряд кнопок-плиток поверх страницы. Он плох не тем, что некрасив, а
 * тем, что ломается по устройству: пунктов больше десятка, на любой ширине часть уезжает за
 * край в горизонтальный скролл, и «где я нахожусь» по нему не прочитать. Меню в колонке
 * растёт вниз — там места сколько угодно.
 *
 * Само меню живёт в AdminNav и рисуется на КАЖДОЙ странице админки (через layout). Здесь к
 * нему добавляются якоря секций этой страницы со scrollspy — их знает только она.
 *
 * Ширина: контент занимает всю ширину экрана с разумными полями. Но «вся ширина» получают
 * ТАБЛИЦЫ и сетки — то, что от неё выигрывает; формы остаются в читаемой колонке, потому что
 * поле ввода на два метра не становится удобнее.
 */
export type { AdminLink, AdminNavGroup } from './AdminNav'

export function AdminShell({ groups, sections, lang }: { groups: AdminNavGroup[]; sections: SettingsSection[]; lang: Lang }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(sections[0]?.id ?? '')

  const query = q.trim().toLowerCase()
  const visible = useMemo(
    () =>
      query
        ? sections.filter((s) => s.title.toLowerCase().includes(query) || s.keywords.some((k) => k.toLowerCase().includes(query)))
        : sections,
    [sections, query],
  )

  // Scrollspy: активна последняя секция, чей верх пересёк линию ~110px (надёжнее
  // IntersectionObserver — им предпоследняя секция часто не получает active).
  useEffect(() => {
    const ids = visible.map((s) => s.id)
    const compute = () => {
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top - 110 <= 1) current = id
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
    // Ширина и поля — на рамке layout админки (одна на весь сайт); здесь только
    // раскладка «меню слева, секции справа».
    <div className="flex w-full min-w-0 flex-col gap-6 md:flex-row md:gap-8">
      <AdminNav groups={groups} lang={lang} sections={sections} activeSection={active} onSectionPick={setActive} onQueryChange={setQ} />

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
        {visible.length > 1 && <div aria-hidden className="h-scroll-tail" />}
      </div>
    </div>
  )
}
