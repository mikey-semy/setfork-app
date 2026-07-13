'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { getAdmin } from '@/shared/auth/admin'
import { moderateContent } from '@/shared/ai/moderate'
import { recordAudit } from '@/shared/audit'
import { requireSession } from '@/shared/auth/session'
import { categorySeverity } from './automation'
import { buildListText, verdictReason } from './moderate-list'

type Mod = 'active' | 'flagged' | 'hidden'

export async function setVerified(templateId: string, verified: boolean): Promise<{ ok: true } | { error: string }> {
  const admin = await getAdmin()
  if (!admin) return { error: 'Доступ запрещён.' }
  await db.update(templates).set({ verified }).where(eq(templates.id, templateId))
  await recordAudit('list.verify', { actorId: admin.userId, targetType: 'list', targetId: templateId, meta: { verified } })
  revalidatePath('/admin/moderation')
  revalidatePath('/explore')
  return { ok: true }
}

export async function setModeration(
  templateId: string,
  moderation: Mod,
  reason?: string,
): Promise<{ ok: true } | { error: string }> {
  const admin = await getAdmin()
  if (!admin) return { error: 'Доступ запрещён.' }
  await db
    .update(templates)
    // Апелляцию закрываем (appealedAt=null) ТОЛЬКО при одобрении. Отказ (повторный
    // flagged/hidden) оставляет пометку поданной апелляции — иначе владелец крутил бы
    // цикл appeal→deny→appeal, забивая очередь админа. Пере-апелляция — после правки
    // (recheck) либо решением админа снять список.
    .set({ moderation, moderationReason: reason ?? null, moderationSeverity: 0, ...(moderation === 'active' ? { appealedAt: null } : {}) })
    .where(eq(templates.id, templateId))
  await recordAudit('list.moderate', { actorId: admin.userId, targetType: 'list', targetId: templateId, meta: { moderation, reason: reason ?? null } })
  revalidatePath('/admin/moderation')
  revalidatePath('/explore')
  return { ok: true }
}

/** Проверить список ИИ вручную (админ); при опасности — flagged + причина. */
export async function aiModerate(templateId: string): Promise<{ flagged: boolean; reason: string } | { error: string }> {
  if (!(await getAdmin())) return { error: 'Доступ запрещён.' }
  const result = await moderateContent(await buildListText(templateId))
  if (!result) return { error: 'Проверка недоступна (нет ключа/ошибка).' }
  await db
    .update(templates)
    .set({
      moderation: result.flagged ? 'flagged' : 'active',
      moderationReason: result.flagged ? verdictReason(result) : null,
      moderationSeverity: result.flagged ? categorySeverity(result.category) : 0,
    })
    .where(eq(templates.id, templateId))
  revalidatePath('/admin/moderation')
  revalidatePath('/explore')
  return { flagged: result.flagged, reason: result.reason }
}

/** Апелляция владельца flagged-списка: поднимает его в топ очереди админа.
 *  Как на YouTube — апелляцию всегда смотрит человек. Одна на решение. */
export async function requestModerationReview(templateId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return { error: 'Доступ запрещён.' }
  if (tpl.moderation !== 'flagged') return { error: 'Апелляция доступна только для flagged-списков.' }
  if (tpl.appealedAt) return { error: 'Апелляция уже подана.' }
  await db.update(templates).set({ appealedAt: new Date() }).where(eq(templates.id, templateId))
  await recordAudit('list.appeal', { actorId: session.userId, targetType: 'list', targetId: templateId, meta: {} })
  revalidatePath('/admin/moderation')
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  return { ok: true }
}

