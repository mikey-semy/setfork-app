'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bell } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Avatar } from '@/shared/ui/Avatar'
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
        <button
          type="button"
          aria-label={t('notifications', lang)}
          className="relative grid h-[1.875rem] w-[1.875rem] place-items-center rounded-md text-ink-2 outline-hidden hover:text-ink"
        >
          <Bell size={17} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-[0.9375rem] min-w-[0.9375rem] place-items-center rounded-full bg-danger px-1 text-[0.6875rem] font-bold text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[21.25rem] p-0">
        <div className="border-b border-border px-3 py-2.5 text-[0.8125rem] font-semibold text-ink">{t('notifications', lang)}</div>

        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-[0.78125rem] text-muted">{t('noNotifications', lang)}</div>
        ) : (
          <div className="max-h-[22.5rem] overflow-auto">
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
                  className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface-2 ${n.read ? '' : 'bg-(--accent-soft)'}`}
                >
                  <Avatar handle={n.actorHandle ?? '?'} avatarUrl={n.actorAvatarUrl} size={26} />
                  <div className="min-w-0 flex-1 text-[0.78125rem] leading-snug text-ink-2">
                    <span className="font-semibold text-ink">{n.actorHandle ?? '—'}</span> {t(NOTIF_VERB[n.type], lang)}
                    {!isFollow && <> <span className="text-ink">{n.title ? tr(n.title, lang) : t('aList', lang)}</span></>}
                  </div>
                  <span className="shrink-0 font-mono text-[0.6875rem] text-muted">{timeAgo(n.createdAt, lang)}</span>
                </Link>
              )
            })}
          </div>
        )}

        <Link
          href="/notifications"
          className="block border-t border-border px-3 py-2.5 text-center text-[0.78125rem] font-semibold text-accent hover:bg-surface-2"
        >
          {t('seeAll', lang)}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
