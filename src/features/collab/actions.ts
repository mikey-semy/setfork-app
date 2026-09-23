'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { collaborators, db, notifications, templates, users } from '@/shared/db'
import { normalizeHandle } from '@/shared/auth/handle-input'
import { requireSession } from '@/shared/auth/session'
import { notify } from '@/features/notifications/notify'

async function ownerGuard(templateId: string, userId: string) {
  const [tpl] = await db
    .select({ id: templates.id, ownerId: templates.ownerId, slug: templates.slug })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!tpl || tpl.ownerId !== userId) return null
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  return owner ? { ...tpl, ownerHandle: owner.handle } : null
}

/** Почему соавтор не добавился — код, а не текст: форма переводит его на язык
 *  страницы. Раньше каждый отказ молчал, и «не нашёлся такой ник» выглядел так же,
 *  как «ничего не произошло» (правило проекта: без тихой деградации). */
export type AddCollaboratorResult = {
  ok?: true
  error?: 'empty' | 'notFound' | 'owner' | 'already' | 'forbidden'
}

/** Добавить коллаборатора по handle (только владелец). */
export async function addCollaborator(
  templateId: string,
  _prev: AddCollaboratorResult | null,
  formData: FormData,
): Promise<AddCollaboratorResult> {
  const session = await requireSession()
  const tpl = await ownerGuard(templateId, session.userId)
  if (!tpl) return { error: 'forbidden' }
  // То же правило, что у поля ввода: «@mike», « @Mike » и «mike» — один человек.
  const handle = normalizeHandle(String(formData.get('handle') ?? ''))
  if (!handle) return { error: 'empty' }
  // Сверка без учёта регистра — как в handleBlock: колонка text unique регистрозависима.
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.handle}) = ${handle}`, eq(users.deleted, false)))
    .limit(1)
  if (!u) return { error: 'notFound' }
  if (u.id === tpl.ownerId) return { error: 'owner' }
  const added = await db
    .insert(collaborators)
    .values({ templateId, userId: u.id, role: 'write' })
    .onConflictDoNothing()
    .returning({ userId: collaborators.userId })
  // Уже соавтор — так и говорим, а не «добавлен»: иначе повтор выглядит как новая выдача.
  if (added.length === 0) return { error: 'already' }
  // Письмо и колокольчик — ОДИН раз на человека и список. Иначе «Добавить → Убрать →
  // Добавить» по кругу слало бы человеку неотключаемые письма с названием, которое
  // выбирает владелец списка, — рассылка чужими руками от нашего домена (ревью по
  // линзе безопасности #973). Помним по самим уведомлениям: их не удаляют, только
  // каскадом вместе со списком или человеком.
  // Соавтору — кто его добавил; владельцу — копия с соавтором в роли действующего
  // лица, чтобы помнить, кому выдан доступ (от своего имени notify себе не шлёт). После
  // вставки: соавтор уже видит список, и гейт видимости уведомления его пропускает.
  if (!(await wasAnnounced(templateId, u.id))) {
    await notify({ recipientId: u.id, actorId: session.userId, type: 'collaborator_added', templateId })
    await notify({ recipientId: tpl.ownerId, actorId: u.id, type: 'collaborator_joined', templateId })
  }
  revalidatePath(`/${tpl.ownerHandle}/${tpl.slug}/settings`)
  return { ok: true }
}

/** Сообщали ли уже этому человеку, что он соавтор этого списка. */
async function wasAnnounced(templateId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, userId),
        eq(notifications.templateId, templateId),
        eq(notifications.type, 'collaborator_added'),
      ),
    )
    .limit(1)
  return !!row
}

/** Убрать коллаборатора (только владелец). */
export async function removeCollaborator(templateId: string, userId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await ownerGuard(templateId, session.userId)
  if (!tpl) return
  await db.delete(collaborators).where(and(eq(collaborators.templateId, templateId), eq(collaborators.userId, userId)))
  revalidatePath(`/${tpl.ownerHandle}/${tpl.slug}/settings`)
}
