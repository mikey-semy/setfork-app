'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, pollVotes, steps, templates, templateVersions, users } from '@/shared/db'
import { getSession, requireSession } from '@/shared/auth/session'
import { canViewList } from '@/features/library/access'
import { pollDeadlineMs } from '@/features/library/blocks'
import { getPollHistory, type PollHistoryEvent } from './queries'

/** Голос за вариант poll-блока. Авторизованные; дедлайн уважается; одиночный
 *  выбор заменяет прошлый голос (клик по выбранному — снимает), мульти — тоггл. */
export async function votePoll(templateId: string, bid: string, optionId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return

  // Poll-блок текущей версии по стабильному bid → варианты/мульти/дедлайн.
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, tpl.currentVersion)))
    .limit(1)
  if (!ver) return
  const [block] = await db
    .select({ content: steps.content })
    .from(steps)
    .where(and(eq(steps.versionId, ver.id), eq(steps.type, 'poll'), sql`${steps.content}->>'bid' = ${bid}`))
    .limit(1)
  if (!block) return
  const content = block.content as { options?: { id: string }[]; multi?: boolean; deadline?: string }
  if (!(content.options ?? []).some((o) => o.id === optionId)) return // невалидный вариант
  const dm = pollDeadlineMs(content.deadline)
  if (dm !== null && dm < Date.now()) return // голосование закрыто
  const multi = content.multi === true

  await db.transaction(async (tx) => {
    const mine = and(eq(pollVotes.userId, session.userId), eq(pollVotes.templateId, templateId), eq(pollVotes.bid, bid))
    if (multi) {
      const [ex] = await tx.select({ id: pollVotes.id }).from(pollVotes).where(and(mine, eq(pollVotes.optionId, optionId))).limit(1)
      if (ex) await tx.delete(pollVotes).where(eq(pollVotes.id, ex.id))
      else await tx.insert(pollVotes).values({ templateId, bid, optionId, userId: session.userId })
    } else {
      const [ex] = await tx.select({ optionId: pollVotes.optionId }).from(pollVotes).where(mine).limit(1)
      await tx.delete(pollVotes).where(mine) // одиночный: всегда снимаем прошлый
      if (ex?.optionId !== optionId) await tx.insert(pollVotes).values({ templateId, bid, optionId, userId: session.userId }) // клик по выбранному = снять
    }
  })

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner) revalidatePath(`/${owner.handle}/${tpl.slug}`)
}

/** Хронология голосов poll-блока для графика динамики. Доступна всем, кто может
 *  видеть список (в т.ч. анониму на публичном). */
export async function pollHistory(templateId: string, bid: string): Promise<{ events: PollHistoryEvent[] } | { error: string }> {
  const session = await getSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { error: 'not_found' }
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session?.userId })) return { error: 'forbidden' }
  return getPollHistory(templateId, bid)
}
