import 'server-only'
import { t, type Lang } from '@/shared/i18n'
import { sendMail } from '@/shared/email/mailer'
import { emailButton } from '@/shared/email/layout'
import { unsubscribeUrl } from '@/shared/email/unsubscribe'
import { resolveNotificationDisplay } from './display'
import type { NotificationType } from './queries'
import { escapeHtml as esc } from '@/shared/lib/escape'


/** Собирает и шлёт письмо по одному уведомлению на языке получателя. true = отправлено. */
export async function sendNotificationEmail(p: {
  to: string
  userId?: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
}): Promise<boolean> {
  const d = await resolveNotificationDisplay(p)
  const subject = d.text

  const body = `<p style="margin:0 0 16px">
        <b>${esc(d.actorHandle)}</b> ${esc(d.verb)}${d.listTitle ? ` <b>${esc(d.listTitle)}</b>` : ''}.
      </p>${emailButton(d.url, t('emailOpen', p.lang))}`

  return sendMail({
    to: p.to,
    subject,
    body,
    lang: p.lang,
    note: t('emailFooter', p.lang),
    unsubscribeUrl: p.userId ? await unsubscribeUrl(p.userId, p.to) : undefined,
  })
}
