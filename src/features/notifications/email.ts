import 'server-only'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, issues, templates, users } from '@/shared/db'
import { t, tr, type Lang, type TKey } from '@/shared/i18n'
import { sendMail } from '@/shared/email/mailer'
import type { NotificationType } from './queries'

// Тип события → ключ глагола (тот же набор, что в колокольчике).
const VERB: Record<NotificationType, TKey> = {
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

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Собирает и шлёт письмо по одному уведомлению на языке получателя. Best-effort. */
export async function sendNotificationEmail(p: {
  to: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
}): Promise<void> {
  const actorAlias = alias(users, 'actor')
  const ownerAlias = alias(users, 'owner')

  const [actor] = p.actorId
    ? await db.select({ handle: actorAlias.handle }).from(actorAlias).where(eq(actorAlias.id, p.actorId)).limit(1)
    : [undefined]

  const [tpl] = p.templateId
    ? await db
        .select({ slug: templates.slug, title: templates.title, owner: ownerAlias.handle })
        .from(templates)
        .innerJoin(ownerAlias, eq(ownerAlias.id, templates.ownerId))
        .where(eq(templates.id, p.templateId))
        .limit(1)
    : [undefined]

  const [iss] = p.issueId && p.templateId
    ? await db.select({ number: issues.number }).from(issues).where(and(eq(issues.id, p.issueId), eq(issues.templateId, p.templateId))).limit(1)
    : [undefined]

  const actorHandle = actor?.handle ?? 'someone'
  const listTitle = tpl ? tr(tpl.title, p.lang) : ''
  const verb = t(VERB[p.type], p.lang)

  const base = tpl ? `${appUrl()}/${tpl.owner}/${tpl.slug}` : appUrl()
  const link = p.type === 'follow' ? `${appUrl()}/${actorHandle}` : iss ? `${base}/issues/${iss.number}` : base

  const subject = listTitle ? `${actorHandle} ${verb} ${listTitle}` : `${actorHandle} ${verb}`
  const openLabel = t('emailOpen', p.lang)
  const footer = t('emailFooter', p.lang)

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:Helvetica,Arial,sans-serif;color:#1c1c1a">
  <div style="max-width:480px;margin:0 auto;padding:24px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-.02em">S<span style="color:#2159d6">F</span></div>
    <div style="background:#fff;border:1px solid #e7e6e0;border-radius:12px;padding:20px;margin-top:14px">
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
        <b>${esc(actorHandle)}</b> ${esc(verb)}${listTitle ? ` <b>${esc(listTitle)}</b>` : ''}.
      </p>
      <a href="${esc(link)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${esc(openLabel)}</a>
    </div>
    <p style="color:#a3a39c;font-size:12px;margin-top:16px">${esc(footer)}</p>
  </div></body></html>`

  await sendMail({ to: p.to, subject, html })
}
