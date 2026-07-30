'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SearchField } from '@/shared/ui/SearchField'
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
}

export interface AdminNavGroup {
  /** Заголовок темы. */
  title: string
  links?: AdminLink[]
  /** Секции текущей страницы (якоря со scrollspy) — только на /admin. */
  sectionIds?: string[]
}

const item = 'flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition-colors'

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
  const panelId = useId()
  const [open, setOpen] = useState(false)
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
  const hit = (label: string) => !query || label.toLowerCase().includes(query)
  const sectionHit = (s: SettingsSection) => !query || s.title.toLowerCase().includes(query) || s.keywords.some((k) => k.toLowerCase().includes(query))

  return (
    <aside className="shrink-0 md:sticky md:top-[73px] md:h-[calc(100vh-89px)] md:w-[232px] md:overflow-y-auto md:pb-6">
      {/* МОБИЛА: двадцать пунктов над контентом — это экран прокрутки до первой настройки,
          поэтому на телефоне меню СВЁРНУТО в одну строку и раскрывается тапом. На md+ —
          обычная липкая колонка, свёртка там только мешала бы.
          Свёртка на СОСТОЯНИИ, а не на <details class="md:contents">: свёрнутый details в
          нынешнем Chrome прячет содержимое через ::details-content, и display:contents его
          не отменяет — меню лежало в DOM, но на десктопе не рисовалось вовсе. Отсюда и
          вопрос «в настройках содержание есть, а в админке нет». Теперь на md+ список
          виден всегда (md:block перебивает hidden), а телефон переключает его кнопкой. */}
      <div className="rounded-lg border border-border bg-surface md:contents">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-[13px] font-semibold text-ink md:hidden"
        >
          {t('adminNavLabel', lang)}
          <ChevronDown size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <div id={panelId} className={`${open ? 'block' : 'hidden'} px-3 pb-3 md:contents`}>
          <SearchField value={q} onValueChange={onQ} placeholder={t('settingsSearchPh', lang)} className="mb-3" clearLabel={t('clear', lang)} />
          <nav className="flex flex-col gap-4">
            {groups.map((g) => {
              const links = (g.links ?? []).filter((l) => hit(l.label))
              const ids = g.sectionIds ?? []
              // Группа, из которой поиск вычистил всё, не оставляет висеть свой заголовок.
              if (!links.length && !ids.length) return null
              return (
                <div key={g.title} className="flex flex-col gap-0.5">
                  <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{g.title}</div>
                  {links.map((l) => {
                    const on = pathname === l.href
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        aria-current={on ? 'page' : undefined}
                        className={`${item} ${on ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}
                      >
                        <span className={on ? 'text-ink' : 'text-muted'}>{l.icon}</span>
                        <span className="min-w-0 truncate">{l.label}</span>
                      </Link>
                    )
                  })}
                  {ids.map((id) => {
                    const s = byId.get(id)
                    if (!s) return null
                    const shown = sectionHit(s)
                    return (
                      <a
                        key={id}
                        href={`#${id}`}
                        onClick={() => onSectionPick?.(id)}
                        className={`${item} ${
                          !shown ? 'pointer-events-none opacity-30' : activeSection === id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:text-ink'
                        } ${s.danger ? 'text-danger' : ''}`}
                      >
                        <span className={activeSection === id ? 'text-ink' : 'text-muted'}>{s.icon}</span>
                        <span className="min-w-0 truncate">{s.title}</span>
                      </a>
                    )
                  })}
                </div>
              )
            })}
          </nav>
        </div>
      </div>
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
    <div className="px-5 pt-6 md:pl-8 md:pr-0">
      <AdminNav groups={groups} lang={lang} />
    </div>
  )
}
