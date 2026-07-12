'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, contentReports, templates } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { requireAdmin } from '@/shared/auth/admin'
import { rateLimit } from '@/shared/rate-limit'
import { recordAudit } from '@/shared/audit'
import { notifyAdmins } from '@/shared/email/admin-notify'
import { escapeHtml as esc } from '@/shared/lib/escape'
// Та же кросс-фичевая связка, что в library/actions.ts (перепроверка после
// события с контентом); распутывание слоёв — docs/boundaries-todo.md.
// eslint-disable-next-line boundaries/dependencies
import { recheckList } from '@/features/moderation/moderate-list'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { parseReport } from './validate'

export type ReportResult = { ok?: boolean; error?: string } | null

/**
 * Приём жалобы на список (DSA notice-and-action / DMCA-интейк). Доступно и
 * анонимам. Жалоба НЕ меняет видимость списка: запись + аудит + фоновая
 * ИИ-перепроверка; решение принимает админ в /admin/reports.
 */
export async function submitReport(_prev: ReportResult, formData: FormData): Promise<ReportResult> {
  const [lang, session] = await Promise.all([getLang(), getSession()])

  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const key = session ? `report:u:${session.userId}` : `report:ip:${ip}`
  if (!(await rateLimit(key, 5, 10 * 60_000)).ok) return { error: t('fbErrRate', lang) }

  const parsed = parseReport({
    templateId: formData.get('templateId'),
    reason: formData.get('reason'),
    body: formData.get('body'),
    email: formData.get('email'),
    website: formData.get('website'),
  })
  if (!parsed.ok) {
    // Ботам с заполненным honeypot отвечаем «успехом» — не подсказываем фильтр.
    if (parsed.error === 'spam') return { ok: true }
    const msg =
      parsed.error === 'body_short' ? t('rpErrShort', lang)
      : parsed.error === 'body_long' ? t('fbErrLong', lang)
      : parsed.error === 'bad_email' ? t('fbErrEmail', lang)
      : t('rpErrGeneric', lang)
    return { error: msg }
  }

  // Список должен существовать; оракул приватности не создаём — жалоба на
  // невидимый список отклоняется той же generic-ошибкой, что и на несуществующий.
  const [tpl] = await db
    .select({ id: templates.id, visibility: templates.visibility })
    .from(templates)
    .where(eq(templates.id, parsed.templateId))
    .limit(1)
  if (!tpl || tpl.visibility !== 'public') return { error: t('rpErrGeneric', lang) }

  await db.insert(contentReports).values({
    templateId: parsed.templateId,
    reporterUserId: session?.userId ?? null,
    reason: parsed.reason,
    body: parsed.body,
    email: parsed.email,
  })

  await recordAudit('list.report', {
    actorId: session?.userId ?? null,
    targetType: 'list',
    targetId: parsed.templateId,
    meta: { reason: parsed.reason },
  })

  // Фоновая ИИ-перепроверка (дедуп и суточный кап — внутри recheckList).
  try {
    await recheckList(parsed.templateId)
  } catch {
    // перепроверка — best-effort, жалоба уже записана
  }

  await notifyReport(parsed.reason, parsed.body, session?.handle ?? null)
  return { ok: true }
}

/** Письмо админам: получатели — настройка email.notify_to или ADMIN_HANDLES. */
async function notifyReport(reason: string, body: string, fromHandle: string | null): Promise<void> {
  const excerpt = body.length > 500 ? `${body.slice(0, 500)}…` : body
  await notifyAdmins(
    `SetFork content report: ${reason}`,
    `<p style="font:14px/1.5 sans-serif"><b>${esc(reason)}</b>` +
      ` — ${fromHandle ? esc(fromHandle) : 'anonymous'}</p>` +
      `<p style="font:14px/1.5 sans-serif;white-space:pre-wrap">${esc(excerpt)}</p>` +
      `<p style="font:12px/1.5 sans-serif;color:#888">setfork.com/admin/reports</p>`,
  )
}

/** Админ: смена статуса жалобы. */
export async function setReportStatus(id: string, status: 'new' | 'reviewed' | 'actioned' | 'dismissed'): Promise<void> {
  await requireAdmin()
  if (!['new', 'reviewed', 'actioned', 'dismissed'].includes(status)) return
  await db.update(contentReports).set({ status }).where(eq(contentReports.id, id))
  revalidatePath('/admin/reports')
}
