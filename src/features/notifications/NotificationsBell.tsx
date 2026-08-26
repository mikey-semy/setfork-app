'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bell } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { PanelHead } from '@/shared/ui/panel-parts'
import { PANEL_HEAD, TEXT } from '@/shared/ui/control'
import { Avatar } from '@/shared/ui/Avatar'
import { IconButton } from '@/shared/ui/IconButton'
import { t, tr, type Lang, type TKey } from '@/shared/i18n'
import type { NotificationItem } from './queries'
import { markNotificationsRead } from './actions'
import { NOTIF_VERB } from './verbs'
import { timeAgo } from '@/shared/ui/timeAgo'


export function NotificationsBell({ unread, items, lang }: { unread: number; items: NotificationItem[]; lang: Lang }) {
  const [count, setCount] = useState(unread)

  const onOpenChange = (open: boolean) => {
    if (open && count > 0) {
      setCount(0)
      void markNotificationsRead()
    }
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {/* `relative` — под бейдж счётчика; сам вид и тач-цель берутся у примитива,
            а не пишутся здесь (до этого высота была 30px — мимо шкалы 24/28/32). */}
        <IconButton variant="ghost" label={t('notifications', lang)} className="relative">
          <Bell size={17} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-[0.9375rem] min-w-[0.9375rem] place-items-center rounded-full bg-danger px-1 text-caption font-bold text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </IconButton>
      </DropdownMenuTrigger>
      {/* ВЫСОТА ОГРАНИЧЕНА ДОСТУПНОЙ, а список тянется внутри. Раньше панель считала
          свою высоту сама: шапка + до 360px списка + строка «все уведомления». На
          невысоком окне это не помещалось, а у выпадашки `overflow-hidden` — и хвост
          просто ОБРЕЗАЛСЯ: строка «все уведомления» оказывалась за краем, нажать её было
          нельзя. Тот же приём уже применён у CloneDropdown — значит грабли не новые. */}
      <DropdownMenuContent
        align="end"
        className="flex max-h-(--radix-dropdown-menu-content-available-height) w-[21.25rem] flex-col p-0"
      >
        <PanelHead title={t('notifications', lang)} />

        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-body-sm text-muted">{t('noNotifications', lang)}</div>
        ) : (
          // min-h-0 обязателен: без него flex-ребёнок не сжимается ниже содержимого,
          // и прокрутка не включается — список снова выдавит хвост за край.
          <div className="min-h-0 flex-1 overflow-auto">
            {items.map((n) => {
              const isFollow = n.type === 'follow'
              const listHref = n.ownerHandle && n.slug ? `/${n.ownerHandle}/${n.slug}` : null
              const href = isFollow
                ? `/${n.actorHandle ?? ''}`
                : listHref && n.issueNumber != null
                  ? `${listHref}/issues/${n.issueNumber}`
                  : listHref && n.suggestionId
                    ? `${listHref}/suggestions/${n.suggestionId}`
                    : (listHref ?? '/notifications')
              return (
                <Link
                  key={n.id}
                  href={href}
                  className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface-2 ${n.read ? '' : 'bg-accent-soft'}`}
                >
                  <Avatar handle={n.actorHandle ?? '?'} avatarUrl={n.actorAvatarUrl} size={26} />
                  <div className="min-w-0 flex-1 text-body-sm leading-snug text-ink-2">
                    <span className="font-semibold text-ink">{n.actorHandle ?? '—'}</span> {t(NOTIF_VERB[n.type], lang)}
                    {!isFollow && <> <span className="text-ink">{n.title ? tr(n.title, lang) : t('aList', lang)}</span></>}
                  </div>
                  <span className="shrink-0 font-mono text-caption text-muted">{timeAgo(n.createdAt, lang)}</span>
                </Link>
              )
            })}
          </div>
        )}

        <Link
          href="/notifications"
          className={`block shrink-0 border-t border-border text-center font-semibold text-accent hover:bg-surface-2 ${PANEL_HEAD} ${TEXT.bodySm}`}
        >
          {t('seeAll', lang)}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
