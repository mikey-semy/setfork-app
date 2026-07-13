'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Home, ListChecks, PlayCircle } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

// Постоянный левый рэйл глобальной навигации (desktop lg+): иконка + подпись,
// «где что» видно сразу (принцип VK-очевидности, не спрятано под бургером).
// На узких — скрыт, там навигация в drawer'е бургера. Создание списка — «+» в топ-баре.
type RailItem = { href: string; label: string; icon: typeof Home }

export function SideRail({ lang, authed }: { lang: Lang; authed: boolean }) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))
  const items: RailItem[] = [
    { href: '/', label: t('home', lang), icon: Home },
    { href: '/explore', label: t('explore', lang), icon: Compass },
    ...(authed
      ? [
          { href: '/my-lists', label: t('myLists', lang), icon: ListChecks },
          { href: '/runs', label: t('myRuns', lang), icon: PlayCircle },
        ]
      : []),
  ]
  return (
    <aside aria-label={t('menu', lang)} className="hidden w-[76px] shrink-0 border-r border-border bg-surface lg:block print:hidden">
      {/* Внешний <aside> тянется на всю высоту контента (правая граница = полоса),
          внутренний sticky держит иконки под шапкой при скролле длинных страниц. */}
      <nav className="sticky top-[53px] flex flex-col gap-1 px-2 py-3">
        {items.map((it) => {
          const active = isActive(it.href)
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-[10.5px] font-medium leading-tight ${
                active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <it.icon size={20} className={active ? 'text-accent' : 'text-muted'} />
              {it.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
