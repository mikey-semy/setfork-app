import Link from 'next/link'
import { Bell } from 'lucide-react'
import { requireSession } from '@/shared/auth/session'
import { getLang, } from '@/shared/i18n/server'
import { t, tr, type TKey } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getNotificationsPage, type NotificationItem } from '@/features/notifications/queries'
import { MarkRead } from '@/features/notifications/MarkRead'
import { NOTIF_VERB } from '@/features/notifications/verbs'
import { Pagination } from '@/shared/ui/Pagination'
import { PAGE } from '@/shared/ui/control'
import { AFTER_PARAM, BEFORE_PARAM, cursorHref, decodeCursor, NOTIFICATIONS_PER_PAGE } from '@/shared/lib/paging'


export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('notifications', lang) }
}

/**
 * Лента уведомлений листается КЛЮЧОМ, а не номером страницы.
 *
 * Уведомления прилетают сверху постоянно, и номер здесь не просто неудобен — он неверен:
 * смещение считается от начала выдачи, а начало уезжает вниз, пока ленту читают, и строка
 * с границы либо пропадает, либо приходит дважды (см. shared/lib/paging, раздел keyset).
 * Прыжок на «страницу 7» ленте и не нужен: её читают сверху вниз.
 *
 * Шага два и они зеркальны: `?after=` ведёт вниз (к более старому), `?before=` — вверх.
 * Разбираются в таком порядке, потому что одновременно их в адресе быть не может:
 * `cursorHref` выкидывает оба и ставит ровно один.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string; before?: string }>
}) {
  const session = await requireSession()
  const sp = await searchParams
  // Мусорный курсор — это «показать сначала», а не пятисотка: ссылка могла обломаться в
  // письме или мессенджере, и человеку нужна лента, а не ошибка.
  const back = decodeCursor(sp.before)
  const cursor = back ?? decodeCursor(sp.after)
  const [lang, page] = await Promise.all([
    getLang(),
    getNotificationsPage(session.userId, NOTIFICATIONS_PER_PAGE, cursor, back ? 'before' : 'after'),
  ])
  const items = page.items
  const fwdHref = cursorHref('/notifications', sp, AFTER_PARAM)
  const backHref = cursorHref('/notifications', sp, BEFORE_PARAM)
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })

  return (
    <div className={PAGE}>
      <MarkRead />
      {/* Видимой шапки нет: тот же заголовок уже стоит в TopNav (см. /my-lists).
          Здесь он остаётся только для скринридеров и структуры страницы. */}
      <PageHeader hideTitle title={t('notifications', lang)} />

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
                  n.read ? 'bg-surface' : 'bg-(--accent-soft)'
                }`}
              >
                <Avatar handle={n.actorHandle ?? '?'} avatarUrl={n.actorAvatarUrl} size={30} />
                <div className="min-w-0 flex-1 text-[0.8125rem] text-ink-2">
                  <span className="font-semibold text-ink">{n.actorHandle ?? '—'}</span> {t(NOTIF_VERB[n.type], lang)}
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
                <span className="shrink-0 font-mono text-[0.6875rem] text-muted">{fmt.format(new Date(n.createdAt))}</span>
              </div>
            )
          })}
        </div>
      )}
      {/* Номеров у keyset нет вовсе — только два шага, и каждый живёт, пока есть адрес. */}
      <Pagination
        lang={lang}
        steps={{ prev: page.prev ? backHref(page.prev) : null, next: page.next ? fwdHref(page.next) : null }}
      />
    </div>
  )
}
