'use server'

import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { blockComments, blockCommentThreads, db, suggestions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { resolveListBySlug } from '@/shared/db/resolve-list'
// eslint-disable-next-line boundaries/dependencies -- правило замка ОДНО на все поверхности; живёт у предложений, тот же кросс-фич-паттерн, что у уведомлений
import { canSpeakWhenLocked } from '@/features/library/lock-policy'
// eslint-disable-next-line boundaries/dependencies -- задача заводится тем же ядром, что и форма «Новый вопрос»
import { openIssue } from '@/features/issues/core'

/**
 * ТРЕД → ЗАДАЧА одной кнопкой.
 *
 * Обсуждение на пункте часто упирается в то, что решать надо не здесь: «это надо
 * переписать целиком», «источник устарел». Раньше выход был один — переписать
 * руками в новую задачу, потеряв и контекст, и ссылку назад.
 *
 * Задача создаётся С ЦИТАТОЙ обсуждения и ссылкой на предложение, а в тред
 * уходит ответ с номером задачи: связь видна с обеих сторон, и разговор не
 * обрывается «ушли решать куда-то ещё».
 *
 * Тред при этом НЕ закрывается автоматически: решение «вопрос снят» принимает
 * человек, а перенос в задачу его не снимает — он лишь меняет место.
 */
/**
 * Почему перенос не вышел — ЗНАЧЕНИЕМ. Молчаливых отказов у кнопки и так хватало;
 * два новых (частота и «список не принимает вопросы») человек обязан увидеть, иначе
 * нажатие выглядит как поломка. Остальные ветки остаются тихими осознанно: у них
 * ответ виден в самом треде («→ #N» уже стоит) или кнопки просто нет.
 */
export type ThreadToIssueRefusal = 'rate' | 'noissue'

export async function threadToIssue(owner: string, slug: string, threadId: string): Promise<ThreadToIssueRefusal | null> {
  // Сессия и язык друг от друга не зависят — берём разом.
  const [session, lang] = await Promise.all([requireSession(), getLang()])

  const [row] = await db
    .select({
      threadId: blockCommentThreads.id,
      suggestionId: blockCommentThreads.suggestionId,
      contextSnapshot: blockCommentThreads.contextSnapshot,
      templateId: suggestions.templateId,
      sugNumber: suggestions.number,
      sugNote: suggestions.note,
      lockedAt: suggestions.lockedAt,
    })
    .from(blockCommentThreads)
    .innerJoin(suggestions, eq(suggestions.id, blockCommentThreads.suggestionId))
    .where(eq(blockCommentThreads.id, threadId))
    .limit(1)
  if (!row) return null

  // Сверяем, что owner/slug из адреса — это действительно список треда, а не чужой,
  // подставленный в аргументы. ПРАВА при этом больше не считаются здесь: своя пара
  // проверок (приватность + модерация) жила рядом и повторяла ту, что была у формы
  // «Новый вопрос», — вместе с её же дырой: про ЧЕРНОВИК обе забывали, а про
  // выключенный раздел «Вопросы» не знала ни одна. Теперь их считает ядро задач.
  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl || tpl.id !== row.templateId) return null
  // Заперто — переносят только ведущие раздел: перенос дописывает в тред ответ «→ #N»,
  // то есть это запись в обсуждение (см. features/library/lock-policy). Проверка стоит
  // ПОСЛЕ разрешения списка: раньше не из чего было спросить про право.
  if (row.lockedAt && !(await canSpeakWhenLocked(tpl.ownerId, tpl.id, session.userId))) return null

  // Реплики треда — тело задачи. Черновики ревью НЕ берём: они ещё никому не
  // показаны, и вытаскивать их в публичную задачу нельзя.
  const replies = await db
    .select({ body: blockComments.body, pending: blockComments.pending, handle: users.handle })
    .from(blockComments)
    .innerJoin(users, eq(users.id, blockComments.authorId))
    .where(eq(blockComments.threadId, threadId))
    .orderBy(asc(blockComments.createdAt))
  const visible = replies.filter((r) => !r.pending)
  if (visible.length === 0) return null
  // Уже переносили — второй раз не заводим. Кнопка остаётся на месте, и без этой
  // проверки повторный клик плодил бы задачи-двойники с тем же обсуждением.
  if (visible.some((r) => /^→ #\d+$/.test(r.body.trim()))) return null

  const sugPath = `/${owner}/${slug}/suggestions/${row.sugNumber ?? row.suggestionId}`
  const first = visible[0].body.replace(/\s+/g, ' ').trim()
  const title = (first.slice(0, 120) || row.sugNote.slice(0, 120) || 'discussion').trim()
  const body = [
    `${t('prThreadFromDiscussion', lang)} [#${row.sugNumber ?? ''}](${sugPath}).`,
    row.contextSnapshot ? `\n> ${row.contextSnapshot.replace(/\n/g, '\n> ').slice(0, 1000)}` : '',
    '',
    ...visible.map((r) => `**@${r.handle}:** ${r.body}`),
  ]
    .join('\n')
    .slice(0, 20000)

  // Задача заводится ТЕМ ЖЕ ядром, что и форма «Новый вопрос»: вместе с ним приезжают
  // права, счётчик частоты и — главное — уведомления. Раньше их тут не было вовсе:
  // разговор переносили в задачу, а владелец списка об этом не узнавал.
  const res = await openIssue(session.userId, owner, slug, { title, body })
  if (!res.ok) return res.reason === 'rate' ? 'rate' : 'noissue'

  // Ответ в тред — чтобы связь была видна и отсюда, а не только из задачи.
  await db.insert(blockComments).values({
    threadId,
    authorId: session.userId,
    body: `→ #${res.number}`,
  })
  await db.update(blockCommentThreads).set({ updatedAt: new Date() }).where(eq(blockCommentThreads.id, threadId))

  revalidatePath(sugPath)
  revalidatePath(`/${owner}/${slug}/issues`)
  return null
}
