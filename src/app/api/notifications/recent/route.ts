import { NextResponse } from 'next/server'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type TKey } from '@/shared/i18n'
import { getNotifications, type NotificationType } from '@/features/notifications/queries'
import { NOTIF_VERB } from '@/features/notifications/verbs'

// Тип события → глагол (как в колокольчике) — для тела браузерного уведомления.

/** Последние непрочитанные уведомления для браузерных оповещений (клиент поллит). */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ items: [] }, { status: 401 })
  const lang = await getLang()
  const items = (await getNotifications(session.userId, 10))
    .filter((n) => !n.read)
    .map((n) => {
      const actor = n.actorHandle ?? '—'
      const verb = t(NOTIF_VERB[n.type], lang)
      const title = n.title ? tr(n.title, lang) : ''
      const listHref = n.ownerHandle && n.slug ? `/${n.ownerHandle}/${n.slug}` : null
      const url =
        n.type === 'follow'
          ? `/${n.actorHandle ?? ''}`
          : listHref && n.issueNumber != null
            ? `${listHref}/issues/${n.issueNumber}`
            : (listHref ?? '/notifications')
      return { id: n.id, body: `${actor} ${verb}${title ? ` ${title}` : ''}`, url }
    })
  return NextResponse.json({ items })
}
