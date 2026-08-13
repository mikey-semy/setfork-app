'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { recordAudit } from '@/shared/audit'
import { notify } from '@/features/notifications/notify'
import { curationStore } from '@/features/curation/store'
import { gateListPublication } from '@/features/moderation/moderate-list'
import { canViewList } from '@/core'


// ── Видимость списка (public/private) и удаление ─────────────────────
export async function setListVisibility(templateId: string, visibility: 'public' | 'private'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  if (visibility === 'private') {
    // приватному гейт не нужен — сбрасываем ТОЛЬКО pending; flagged/hidden не
    // «отмываются» toggle'ом видимости — админский takedown снимает только админ.
    const reset =
      tpl.moderation === 'pending'
        ? { moderation: 'active' as const, moderationReason: null, moderationSeverity: 0 }
        : {}
    await db.update(templates).set({ visibility, ...reset }).where(eq(templates.id, templateId))
  } else {
    await db.update(templates).set({ visibility }).where(eq(templates.id, templateId))
    // Гейт — на момент, когда список СТАНОВИТСЯ ВИДИМЫМ. У черновика этот момент
    // ещё не наступил: его не видит никто, кроме владельца и соавторов, а проверку
    // он всё равно пройдёт при публикации (publishList). Без этой оговорки выбор
    // «опубликую публичным» тратил бы LLM-проверку (кап 20/сутки на автора) на
    // список, которого никто не видит, и гейт срабатывал бы дважды подряд.
    if (tpl.status !== 'draft') await gateListPublication(templateId)
  }
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath('/explore')
}

/** «Customize your pins»: закрепить ровно выбранный набор своих списков (кап 6). */
export async function updatePins(templateIds: string[]): Promise<void> {
  const session = await requireSession()
  const ids = templateIds.slice(0, 6)
  // Сначала снимаем все свои пины, затем ставим выбранные — итог точно равен выбору.
  await db.update(templates).set({ pinned: false }).where(eq(templates.ownerId, session.userId))
  if (ids.length) {
    await db
      .update(templates)
      .set({ pinned: true })
      .where(and(eq(templates.ownerId, session.userId), inArray(templates.id, ids)))
  }
  revalidatePath(`/${session.handle}`)
}

export async function setListPinned(templateId: string, pinned: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ pinned }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

export async function deleteListAction(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  // Снятый модерацией список владелец удалить не может: hard-delete стёр бы его
  // contentFingerprint — единственную защиту от повторной заливки того же контента
  // (отмывка «удалил → залил заново»). Снять/удалить takedown вправе только админ;
  // легитимный путь для владельца — апелляция.
  if ((tpl.moderation === 'flagged' || tpl.moderation === 'hidden') && !isAdminHandle(session.handle)) {
    redirect(`/${session.handle}/${tpl.slug}/settings?e=locked_moderation`)
  }
  await db.delete(templates).where(eq(templates.id, templateId)) // каскад: версии/шаги/звёзды/предложения
  await recordAudit('list.delete', { actorId: session.userId, targetType: 'list', targetId: templateId, meta: { slug: tpl.slug } })
  revalidatePath('/', 'layout')
  redirect(`/${session.handle}`)
}

// ── Обратимые состояния: архив (read-only) и заморозка правок ─────────
// Владелец переключает из Danger Zone. Ставят/снимают timestamp; сами эти
// экшены доступны и в архиве (иначе разархивировать было бы нечем).
export async function setListArchived(templateId: string, on: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ archivedAt: on ? new Date() : null }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`, 'layout')
}

export async function setListFrozen(templateId: string, on: boolean): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  await db.update(templates).set({ frozenAt: on ? new Date() : null }).where(eq(templates.id, templateId))
  revalidatePath(`/${session.handle}/${tpl.slug}`, 'layout')
}


// ── Star (сигнал качества + личная коллекция) ────────────────────────
export async function toggleStar(templateId: string): Promise<void> {
  const session = await requireSession()
  // Видимость проверяем ДО тоггла: нельзя звездить (и пинговать владельца)
  // приватный/скрытый список, которого не видишь.
  const [t] = await db
    .select({ ownerId: templates.ownerId, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!t || !canViewList(t, { isOwner: t.ownerId === session.userId })) return
  const nowStarred = await curationStore.toggleStar(templateId, session.userId)
  if (nowStarred) await notify({ recipientId: t.ownerId, actorId: session.userId, type: 'star', templateId })
  revalidatePath('/', 'layout')
}
