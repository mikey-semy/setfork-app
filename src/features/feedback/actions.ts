'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, feedback } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { requireAdmin } from '@/shared/auth/admin'
import { rateLimit } from '@/shared/rate-limit'
import { notifyAdmins } from '@/shared/email/admin-notify'
import { appOrigin } from '@/shared/auth/app-origin'
import { escapeHtml as esc } from '@/shared/lib/escape'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { parseFeedback } from './validate'

export type FeedbackResult = { ok?: boolean; error?: string } | null

/** Приём фидбека: доступен и анонимам (лимит по IP), и вошедшим (лимит по user). */
export async function submitFeedback(_prev: FeedbackResult, formData: FormData): Promise<FeedbackResult> {
  const [lang, session] = await Promise.all([getLang(), getSession()])

  // Анти-спам: гость — по первому IP из X-Forwarded-For (за Cloudflare), юзер — по id.
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const key = session ? `feedback:u:${session.userId}` : `feedback:ip:${ip}`
  if (!(await rateLimit(key, 5, 10 * 60_000)).ok) return { error: t('fbErrRate', lang) }

  const parsed = parseFeedback({
    category: formData.get('category'),
    body: formData.get('body'),
    email: formData.get('email'),
    pageUrl: formData.get('pageUrl'),
    website: formData.get('website'),
  })
  if (!parsed.ok) {
    // Ботам с заполненным honeypot отвечаем «успехом» — не подсказываем фильтр.
    if (parsed.error === 'spam') return { ok: true }
    const msg =
      parsed.error === 'body_short' ? t('fbErrShort', lang)
      : parsed.error === 'body_long' ? t('fbErrLong', lang)
      : t('fbErrEmail', lang)
    return { error: msg }
  }

  await db.insert(feedback).values({
    userId: session?.userId ?? null,
    category: parsed.category,
    body: parsed.body,
    email: parsed.email,
    pageUrl: parsed.pageUrl,
  })

  await notifyFeedback(parsed.category, parsed.body, session?.handle ?? null)
  return { ok: true }
}

/** Письмо админам: получатели — настройка email.notify_to или ADMIN_HANDLES. */
async function notifyFeedback(category: string, body: string, fromHandle: string | null): Promise<void> {
  const excerpt = body.length > 500 ? `${body.slice(0, 500)}…` : body
  await notifyAdmins(
    `SetFork feedback: ${category}`,
    `<p style="font:14px/1.5 sans-serif"><b>${esc(category)}</b>` +
      ` — ${fromHandle ? esc(fromHandle) : 'anonymous'}</p>` +
      `<p style="font:14px/1.5 sans-serif;white-space:pre-wrap">${esc(excerpt)}</p>` +
      `<p style="font:12px/1.5 sans-serif;color:#888">${esc(`${appOrigin()}/admin/feedback`)}</p>`,
  )
}

/** Админ: смена статуса записи (new → seen → done). */
export async function setFeedbackStatus(id: string, status: 'new' | 'seen' | 'done'): Promise<void> {
  await requireAdmin()
  if (!['new', 'seen', 'done'].includes(status)) return
  await db.update(feedback).set({ status }).where(eq(feedback.id, id))
  revalidatePath('/admin/feedback')
}
