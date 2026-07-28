'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SearchField } from '@/shared/ui/SearchField'
import { t, type Lang } from '@/shared/i18n'
import type { SettingsSection } from '@/features/settings/SettingsShell'

/**
 * ОБОЛОЧКА АДМИНКИ: одно боковое меню на всё — и страницы, и секции настроек.
 *
 * Было: горизонтальный ряд кнопок-плиток поверх страницы. Он плох не тем, что некрасив, а
 * тем, что ломается по устройству: пунктов больше десятка, на любой ширине часть уезжает за
 * край в горизонтальный скролл, и «где я нахожусь» по нему не прочитать. Меню в колонке
 * растёт вниз — там места сколько угодно.
 *
 * Пункты СГРУППИРОВАНЫ по темам с заголовками: обзор, контент и жалобы, настройки инстанса.
 * Плоский список из двадцати строк — та же куча, только вертикальная.
 *
 * Ширина: контент занимает всю ширину экрана с разумными полями. Но «вся ширина» получают
 * ТАБЛИЦЫ и сетки — то, что от неё выигрывает; формы остаются в читаемой колонке, потому что
 * поле ввода на два метра не становится удобнее.
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
  /** Секции текущей страницы (якоря со scrollspy). */
  sectionIds?: string[]
}

export function AdminShell({
  groups,
  sections,
  lang,
  currentPath,
}: {
  groups: AdminNavGroup[]
  sections: SettingsSection[]
  lang: Lang
  currentPath: string
}) {
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
  const byId = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections])

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

  const item = 'flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition-colors'

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 px-5 py-6 md:flex-row md:gap-8 md:px-8">
      {/* МОБИЛА: двадцать пунктов над контентом — это экран прокрутки до первой настройки,
          поэтому на телефоне меню СВЁРНУТО в одну строку и раскрывается тапом. На md+ —
          обычная липкая колонка, свёртка там только мешала бы. */}
      <aside className="shrink-0 md:sticky md:top-[73px] md:h-[calc(100vh-89px)] md:w-[232px] md:overflow-y-auto md:pb-6">
        <details className="group rounded-lg border border-border bg-surface md:contents">
          <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-3 text-[13px] font-semibold text-ink md:hidden">
            {t('adminNavLabel', lang)}
            <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-3 pb-3 md:contents">
        <SearchField value={q} onValueChange={setQ} placeholder={t('settingsSearchPh', lang)} className="mb-3" clearLabel={t('clear', lang)} />
        <nav className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{g.title}</div>
              {(g.links ?? []).map((l) => {
                const on = currentPath === l.href
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
              {(g.sectionIds ?? []).map((id) => {
                const s = byId.get(id)
                if (!s) return null
                const shown = visible.some((v) => v.id === id)
                return (
                  <a
                    key={id}
                    href={`#${id}`}
                    onClick={() => setActive(id)}
                    className={`${item} ${
                      !shown ? 'pointer-events-none opacity-30' : active === id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:text-ink'
                    } ${s.danger ? 'text-danger' : ''}`}
                  >
                    <span className={active === id ? 'text-ink' : 'text-muted'}>{s.icon}</span>
                    <span className="min-w-0 truncate">{s.title}</span>
                  </a>
                )
              })}
            </div>
          ))}
        </nav>
          </div>
        </details>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">{t('noSettingsFound', lang)}</div>
        ) : (
          visible.map((s) => (
            <div key={s.id} id={s.id} className="scroll-mt-[76px]">
              {s.content}
            </div>
          ))
        )}
        {visible.length > 1 && <div aria-hidden className="h-[45vh]" />}
      </div>
    </div>
  )
}
