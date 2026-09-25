'use server'

import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, publiclyVisible, templates, users } from '@/shared/db'
import { MAX_PINS } from '@/core/domain/pins'
import { requireSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { recordAudit } from '@/shared/audit'
import { notify } from '@/features/notifications/notify'
import { curationStore } from '@/features/curation/store'
import { gateListPublication } from '@/features/moderation/moderate-list'
import { canViewList } from '@/core'
import { canBePublic } from '@/core/domain/skill-license'


// ── Видимость списка (public/private) и удаление ─────────────────────
export async function setListVisibility(templateId: string, visibility: 'public' | 'private'): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  // Импорт без открытой лицензии публичным не становится (решение владельца 25.09.2026).
  // Интерфейс такую кнопку не показывает; отказ здесь — для запроса мимо него.
  if (visibility === 'public' && !canBePublic(tpl)) return
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
/**
 * Закрепления владельца меняются ПО ОЧЕРЕДИ: строка владельца берётся `for update`.
 * Счёт и запись в разных строках списков не сериализуются сами — два одновременных
 * «закрепить» из соседних вкладок читали бы один и тот же счёт и оба проходили (находка
 * авто-ревью). Тот же приём, что у ключей входа (`auth/passkey-core`).
 */
async function withPinsLock<T>(userId: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${users} where ${users.id} = ${userId} for update`)
    return fn(tx)
  })
}

export async function updatePins(templateIds: string[]): Promise<void> {
  const session = await requireSession()
  // Правило то же, что у окна (`core/domain/pins`): только свои, видимые всем, не
  // больше шести. Проверяем здесь, а не верим окну: экшен зовут и мимо него.
  // Предел — ДО запроса: экшен можно позвать мимо окна с тысячей id, и каждый попал бы
  // в `IN` (находка авто-ревью). Окно больше шести не присылает.
  const wanted = [...new Set(templateIds)].slice(0, MAX_PINS)
  await withPinsLock(session.userId, async (tx) => {
    const allowed = wanted.length
      ? new Set(
          (
            await tx
              .select({ id: templates.id })
              .from(templates)
              .where(and(eq(templates.ownerId, session.userId), inArray(templates.id, wanted), publiclyVisible()))
          ).map((r) => r.id),
        )
      : new Set<string>()
    const ids = wanted.filter((id) => allowed.has(id))
    // Сначала снимаем все свои пины, затем ставим выбранные — итог точно равен выбору.
    await tx.update(templates).set({ pinned: false }).where(eq(templates.ownerId, session.userId))
    if (ids.length) {
      await tx
        .update(templates)
        .set({ pinned: true })
        .where(and(eq(templates.ownerId, session.userId), inArray(templates.id, ids)))
    }
  })
  revalidatePath(`/${session.handle}`)
}

/** `full` — уже закреплено шесть; `notPublic` — список видят не все. */
export type PinResult = { ok: true } | { error: 'full' | 'notPublic' }

export async function setListPinned(templateId: string, pinned: boolean): Promise<PinResult> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return { error: 'notPublic' }
  if (!pinned) {
    await db.update(templates).set({ pinned: false }).where(eq(templates.id, templateId))
  } else {
    // ⚠️ Счёт и запись — под замком владельца (`withPinsLock`), а в счёт идут только
    // закреплённые, которые ВИДНЫ: список, ставший приватным или снятый модерацией,
    // флаг сохраняет, но на профиле его нет — занимать им слот значило бы отказывать
    // «уже шесть», когда видно пять (находка авто-ревью). Кнопка в шапке раньше не
    // считала вовсе и закрепляла седьмой, восьмой и дальше.
    const outcome = await withPinsLock(session.userId, async (tx) => {
      const [target] = await tx
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.id, templateId), eq(templates.ownerId, session.userId), publiclyVisible()))
      if (!target) return 'notPublic' as const
      // Закрепление, «уснувшее» вместе со списком (стал приватным, черновиком, снят
      // модерацией), снимается ЗДЕСЬ, до подсчёта. Просто не считать его мало: вернись
      // список в публичные — на профиле стало бы семь (находка авто-ревью). А снимать в
      // каждом пути, где список теряет видимость, значит однажды забыть один из пяти.
      // Так же ведёт себя GitHub: ставший приватным репозиторий с профиля открепляется.
      await tx
        .update(templates)
        .set({ pinned: false })
        .where(and(eq(templates.ownerId, session.userId), eq(templates.pinned, true), sql`not (${publiclyVisible()})`))
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(templates)
        .where(and(eq(templates.ownerId, session.userId), eq(templates.pinned, true), ne(templates.id, templateId)))
      if (n >= MAX_PINS) return 'full' as const
      await tx.update(templates).set({ pinned: true }).where(eq(templates.id, templateId))
      return 'ok' as const
    })
    if (outcome !== 'ok') return { error: outcome }
  }
  revalidatePath(`/${session.handle}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
  return { ok: true }
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
