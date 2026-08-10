'use server'

import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { collaborators, db, listRedirects, templates, transferInvites, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { recordAudit } from '@/shared/audit'
import { notify } from '@/features/notifications/notify'
import { enqueueReindex } from '@/features/library/jobs'

export type TransferResult = { ok?: true; error?: string }

/** Инициировать передачу владения (владелец). Создаёт pending-инвайт получателю;
 *  сама смена ownerId — только при принятии (acceptTransfer). */
export async function initiateTransfer(templateId: string, _prev: TransferResult | null, formData: FormData): Promise<TransferResult> {
  const session = await requireSession()
  const [tpl] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1)
  if (!tpl || tpl.ownerId !== session.userId) return { error: 'Список не найден.' }
  // Снятый модерацией список не передаём (как и не удаляем — иначе перенос обходил бы takedown).
  if ((tpl.moderation === 'flagged' || tpl.moderation === 'hidden') && !isAdminHandle(session.handle)) {
    return { error: 'Список, снятый модерацией, передать нельзя.' }
  }
  const toHandle = String(formData.get('toHandle') ?? '').trim().toLowerCase().replace(/^@+/, '')
  if (!toHandle) return { error: 'Укажите ник получателя.' }
  const [to] = await db.select({ id: users.id, deleted: users.deleted }).from(users).where(eq(users.handle, toHandle)).limit(1)
  if (!to || to.deleted) return { error: 'Пользователь не найден.' }
  if (to.id === session.userId) return { error: 'Нельзя передать список самому себе.' }

  try {
    await db.insert(transferInvites).values({ templateId, fromUserId: session.userId, toUserId: to.id })
  } catch {
    // partial-unique transfer_one_pending: уже есть ожидающий инвайт на этот список
    return { error: 'По этому списку уже есть ожидающее приглашение.' }
  }
  await notify({ recipientId: to.id, actorId: session.userId, type: 'transfer_incoming', templateId })
  await recordAudit('list.transfer-init', { actorId: session.userId, targetType: 'list', targetId: templateId, meta: { to: toHandle } })
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
  return { ok: true }
}

/** Отменить своё ожидающее приглашение (владелец-отправитель). */
export async function cancelTransfer(inviteId: string): Promise<void> {
  const session = await requireSession()
  const [inv] = await db.select().from(transferInvites).where(eq(transferInvites.id, inviteId)).limit(1)
  if (!inv || inv.fromUserId !== session.userId || inv.status !== 'pending') return
  await db.update(transferInvites).set({ status: 'cancelled', resolvedAt: new Date() }).where(eq(transferInvites.id, inviteId))
  revalidatePath('/', 'layout')
}

/** Отклонить входящее приглашение (получатель). */
export async function declineTransfer(inviteId: string): Promise<void> {
  const session = await requireSession()
  const [inv] = await db.select().from(transferInvites).where(eq(transferInvites.id, inviteId)).limit(1)
  if (!inv || inv.toUserId !== session.userId || inv.status !== 'pending') return
  await db.update(transferInvites).set({ status: 'declined', resolvedAt: new Date() }).where(eq(transferInvites.id, inviteId))
  await notify({ recipientId: inv.fromUserId, actorId: session.userId, type: 'transfer_declined', templateId: inv.templateId })
  revalidatePath('/settings')
}

/** Принять входящее приглашение (получатель) — здесь и происходит смена владельца. */
export async function acceptTransfer(inviteId: string): Promise<void> {
  const session = await requireSession()
  const [inv] = await db.select().from(transferInvites).where(eq(transferInvites.id, inviteId)).limit(1)
  if (!inv || inv.toUserId !== session.userId || inv.status !== 'pending') return
  const [tpl] = await db.select().from(templates).where(eq(templates.id, inv.templateId)).limit(1)
  // Список мог уже сменить владельца/удалиться — инвайт протух.
  if (!tpl || tpl.ownerId !== inv.fromUserId) {
    await db.update(transferInvites).set({ status: 'cancelled', resolvedAt: new Date() }).where(eq(transferInvites.id, inviteId))
    return
  }

  // Уникальность slug в пределах НОВОГО владельца (тот же дедуп, что при переносе на ghost).
  //
  // Прежние адреса получателя тоже заняты: если принять список на слаг, который у
  // получателя лежит в list_redirects, прямой лукап начнёт находить ЭТОТ список и
  // затенит перенаправление — старые ссылки на совсем другой список молча приведут
  // сюда. Поэтому оба источника в одном наборе.
  const [live, previous] = await Promise.all([
    db.select({ slug: templates.slug }).from(templates).where(eq(templates.ownerId, session.userId)),
    db.select({ slug: listRedirects.slug }).from(listRedirects).where(eq(listRedirects.ownerId, session.userId)),
  ])
  const taken = new Set([...live, ...previous].map((r) => r.slug))
  let slug = tpl.slug
  if (taken.has(slug)) {
    let i = 2
    while (taken.has(`${slug}-${i}`)) i++
    slug = `${slug}-${i}`
  }

  await db
    .update(templates)
    .set({
      ownerId: session.userId,
      slug,
      pinned: false, // пин — «на профиле старого владельца», сбрасываем
      repositoryId: null, // каталог принадлежит старому владельцу — отвязываем
    })
    .where(eq(templates.id, tpl.id))
  // Новый владелец мог быть коллаборатором — убираем (иначе и владелец, и коллаб).
  await db.delete(collaborators).where(and(eq(collaborators.templateId, tpl.id), eq(collaborators.userId, session.userId)))
  await db.update(transferInvites).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(transferInvites.id, inviteId))
  // Прочие ожидающие инвайты по этому списку (если бы были) больше не валидны.
  await db
    .update(transferInvites)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(and(eq(transferInvites.templateId, tpl.id), eq(transferInvites.status, 'pending'), ne(transferInvites.id, inviteId)))

  await notify({ recipientId: inv.fromUserId, actorId: session.userId, type: 'transfer_accepted', templateId: tpl.id })
  await recordAudit('list.transfer-accept', { actorId: session.userId, targetType: 'list', targetId: tpl.id, meta: { from: inv.fromUserId, slug } })
  await enqueueReindex(tpl.id)
  revalidatePath('/', 'layout')
}
