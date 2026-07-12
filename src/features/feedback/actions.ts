'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { db, feedback, users } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { requireAdmin } from '@/shared/auth/admin'
import { rateLimit } from '@/shared/rate-limit'
import { sendMail } from '@/shared/email/mailer'
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

  await notifyAdmins(parsed.category, parsed.body, session?.handle ?? null)
  return { ok: true }
}

/** Письмо админам (best-effort: без SMTP тихо пропускается, ошибки не роняют приём). */
async function notifyAdmins(category: string, body: string, fromHandle: string | null): Promise<void> {
  try {
    const handles = (process.env.ADMIN_HANDLES || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (!handles.length) return
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.handle, handles))
    const emails = rows.map((r) => r.email).filter((e): e is string => !!e)
    if (!emails.length) return
    const excerpt = body.length > 500 ? `${body.slice(0, 500)}…` : body
    await Promise.all(
      emails.map((to) =>
        sendMail({
          to,
          subject: `SetFork feedback: ${category}`,
          html:
            `<p style="font:14px/1.5 sans-serif"><b>${esc(category)}</b>` +
            ` — ${fromHandle ? esc(fromHandle) : 'anonymous'}</p>` +
            `<p style="font:14px/1.5 sans-serif;white-space:pre-wrap">${esc(excerpt)}</p>` +
            `<p style="font:12px/1.5 sans-serif;color:#888">setfork.com/admin/feedback</p>`,
        }),
      ),
    )
  } catch {
    // почта — не критичный путь: фидбек уже сохранён
  }
}

/** Админ: смена статуса записи (new → seen → done). */
export async function setFeedbackStatus(id: string, status: 'new' | 'seen' | 'done'): Promise<void> {
  await requireAdmin()
  if (!['new', 'seen', 'done'].includes(status)) return
  await db.update(feedback).set({ status }).where(eq(feedback.id, id))
  revalidatePath('/admin/feedback')
}
