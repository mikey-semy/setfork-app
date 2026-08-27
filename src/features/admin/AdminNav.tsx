'use client'

import { usePathname } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'
import { SideNav, type SideNavGroup } from '@/shared/ui/SideNav'
import { t, type Lang } from '@/shared/i18n'
import type { SettingsSection } from '@/features/settings/SettingsShell'

/**
 * МЕНЮ АДМИНКИ — одно на все её страницы.
 *
 * Раньше меню жило только на /admin: стоило провалиться в «Дашборд» или «Теги», как
 * навигация исчезала и остаётся ссылка «← Админка». То есть переход между двумя
 * соседними разделами — это всегда возврат в корень и повторный поиск глазами. В
 * настройках списка содержание никуда не девается, и владелец справедливо спросил,
 * почему в админке иначе.
 *
 * Поэтому меню отрисовывается в layout — на любой странице /admin/*. На самой /admin
 * его рисует оболочка (там к ссылкам добавляются якоря секций со scrollspy), поэтому
 * слот в layout на индексе молчит: см. AdminNavSlot.
 */
export interface AdminLink {
  href: string
  label: string
  icon: ReactNode
  /** Синонимы для поиска по меню («smtp» находит «Почта»). На /admin их даёт сама
   *  секция, на остальных страницах они приезжают вместе со ссылкой. */
  keywords?: string[]
}

export interface AdminNavGroup {
  /** Заголовок темы. */
  title: string
  links?: AdminLink[]
  /** Секции текущей страницы (якоря со scrollspy) — только на /admin. */
  sectionIds?: string[]
}

export function AdminNav({
  groups,
  lang,
  sections = [],
  activeSection,
  onSectionPick,
  onQueryChange,
}: {
  groups: AdminNavGroup[]
  lang: Lang
  /** Секции текущей страницы — нужны для подписей и затемнения непопавших под поиск. */
  sections?: SettingsSection[]
  activeSection?: string
  onSectionPick?: (id: string) => void
  /** Поиск разделяемый: оболочка тем же запросом фильтрует контент страницы. */
  onQueryChange?: (q: string) => void
}) {
  const pathname = usePathname()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  // Запрос сообщаем сразу в обработчике, а не эффектом: эффект дал бы лишний каскад
  // рендеров ради значения, которое уже на руках.
  const onQ = (v: string) => {
    setQ(v)
    onQueryChange?.(v)
  }

  const byId = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections])
  // Поиск фильтрует и ссылки: пунктов больше десятка, и «где тут теги» — обычный вопрос.
  const hit = (l: AdminLink) =>
    !query || l.label.toLowerCase().includes(query) || (l.keywords ?? []).some((k) => k.toLowerCase().includes(query))
  const sectionHit = (s: SettingsSection) => !query || s.title.toLowerCase().includes(query) || s.keywords.some((k) => k.toLowerCase().includes(query))

  // Каркас и вид — общий SideNav (Ф10); здесь остаётся только логика админки:
  // активность ссылок по pathname, якоря секций со scrollspy, общий поиск.
  const navGroups: SideNavGroup[] = groups
    .map((g) => ({
      title: g.title,
      items: [
        // Один проход (flatMap), а не filter+map: отбор и превращение в пункт —
        // одно и то же действие над списком (React Doctor, js-combine-iterations).
        ...(g.links ?? []).flatMap((l) =>
          hit(l)
            ? [
                {
                  key: l.href,
                  href: l.href,
                  label: l.label,
                  icon: l.icon,
                  active: pathname === l.href,
                },
              ]
            : [],
        ),
        ...(g.sectionIds ?? []).flatMap((id) => {
          const s = byId.get(id)
          if (!s) return []
          return [
            {
              key: id,
              href: `#${id}`,
              label: s.title,
              icon: s.icon,
              active: activeSection === id,
              dimmed: !sectionHit(s),
              danger: s.danger,
              onClick: () => onSectionPick?.(id),
            },
          ]
        }),
      ],
    }))
    // Группа, из которой поиск вычистил всё, не оставляет висеть свой заголовок.
    .filter((g) => g.items.length > 0)

  return (
    <aside className="shrink-0 md:sticky md:top-[4.5625rem] md:h-[calc(100vh-89px)] md:w-menu md:overflow-y-auto md:pb-6">
      <SideNav
        mobileLabel={t('adminNavLabel', lang)}
        search={{ value: q, onChange: onQ, placeholder: t('settingsSearchPh', lang), clearLabel: t('clear', lang) }}
        groups={navGroups}
      />
    </aside>
  )
}

/**
 * Слот меню в layout: молчит на самой /admin, где меню рисует оболочка вместе с
 * якорями секций. Проверка по пути — единственное, что тут нужно от клиента.
 */
export function AdminNavSlot({ groups, lang }: { groups: AdminNavGroup[]; lang: Lang }) {
  const pathname = usePathname()
  if (pathname === '/admin') return null
  return (
    // Полей и ширины здесь нет: рамку на меню и контент даёт layout админки.
    <AdminNav groups={groups} lang={lang} />
  )
}
