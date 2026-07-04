import Link from 'next/link'
import { Bell } from 'lucide-react'
import { requireSession } from '@/shared/auth/session'
import { getLang, } from '@/shared/i18n/server'
import { t, tr, type TKey } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { getNotifications, type NotificationItem } from '@/features/notifications/queries'
import { MarkRead } from '@/features/notifications/MarkRead'

const VERB: Record<NotificationItem['type'], TKey> = {
  suggestion_new: 'notifSuggestionNew',
  suggestion_accepted: 'notifAccepted',
  suggestion_rejected: 'notifRejected',
  suggestion_comment: 'notifSuggestionComment',
  issue_new: 'notifIssueNew',
  issue_comment: 'notifIssueComment',
  new_version: 'notifNewVersion',
  star: 'notifStar',
  fork: 'notifFork',
  follow: 'notifFollow',
  mention: 'notifMention',
  assigned: 'notifAssigned',
}

export default async function NotificationsPage() {
  const session = await requireSession()
  const lang = await getLang()
  const items = await getNotifications(session.userId)
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { day: 'numeric', month: 'short' })

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <MarkRead />
      <h1 className="mb-5 text-[18px] font-bold text-ink">{t('notifications', lang)}</h1>

      {items.length === 0 ? (
        <EmptyState icon={<Bell size={34} strokeWidth={1.5} />} title={t('noNotifications', lang)} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((n) => {
            const isFollow = n.type === 'follow'
            const listTitle = n.title ? tr(n.title, lang) : t('aList', lang)
            const listHref = n.ownerHandle && n.slug ? `/${n.ownerHandle}/${n.slug}` : null
            const href = isFollow
              ? `/${n.actorHandle ?? ''}`
              : listHref && n.issueNumber != null
                ? `${listHref}/issues/${n.issueNumber}`
                : listHref && n.suggestionId
                  ? `${listHref}/suggestions/${n.suggestionId}`
                  : listHref
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 rounded-lg border border-border px-3.5 py-3 ${
                  n.read ? 'bg-surface' : 'bg-[var(--accent-soft)]'
                }`}
              >
                <Avatar handle={n.actorHandle ?? '?'} avatarUrl={n.actorAvatarUrl} size={30} />
                <div className="min-w-0 flex-1 text-[13.5px] text-ink-2">
                  <span className="font-semibold text-ink">{n.actorHandle ?? '—'}</span> {t(VERB[n.type], lang)}
                  {isFollow ? null : href ? (
                    <>
                      {' '}
                      <Link href={href} className="font-medium text-accent hover:underline">
                        {listTitle}
                      </Link>
                    </>
                  ) : (
                    <> <span className="text-ink">{listTitle}</span></>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[11.5px] text-muted">{fmt.format(new Date(n.createdAt))}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
