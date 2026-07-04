import 'server-only'
import { t, type Lang } from '@/shared/i18n'
import { sendMail } from '@/shared/email/mailer'
import { resolveNotificationDisplay } from './display'
import type { NotificationType } from './queries'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Собирает и шлёт письмо по одному уведомлению на языке получателя. true = отправлено. */
export async function sendNotificationEmail(p: {
  to: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
}): Promise<boolean> {
  const d = await resolveNotificationDisplay(p)
  const subject = d.text
  const openLabel = t('emailOpen', p.lang)
  const footer = t('emailFooter', p.lang)

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:Helvetica,Arial,sans-serif;color:#1c1c1a">
  <div style="max-width:480px;margin:0 auto;padding:24px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-.02em">S<span style="color:#2159d6">F</span></div>
    <div style="background:#fff;border:1px solid #e7e6e0;border-radius:12px;padding:20px;margin-top:14px">
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
        <b>${esc(d.actorHandle)}</b> ${esc(d.verb)}${d.listTitle ? ` <b>${esc(d.listTitle)}</b>` : ''}.
      </p>
      <a href="${esc(d.url)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${esc(openLabel)}</a>
    </div>
    <p style="color:#a3a39c;font-size:12px;margin-top:16px">${esc(footer)}</p>
  </div></body></html>`

  return sendMail({ to: p.to, subject, html })
}
