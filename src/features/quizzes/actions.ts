'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, quizAttempts, steps, templates, templateVersions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/features/library/access'

export interface QuizVerdict {
  ok: boolean // прошёл (точное совпадение с верными)
  correctIds: string[] // верные варианты — раскрываются ТОЛЬКО после отправки
  attempts: number // сколько попыток сделал (для UI «попытка N»)
}

/** Отправка ответа на quiz-блок. Оценка на СЕРВЕРЕ (correct-флаги берём из
 *  git-content текущей версии, а не с клиента). Результат — одна строка на
 *  (user, tpl, bid), пересдача перезаписывает её и инкрементит attempts. */
export async function submitQuiz(templateId: string, bid: string, selectedIds: string[]): Promise<QuizVerdict | { error: string }> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { error: 'not_found' }
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'forbidden' }

  // Quiz-блок текущей версии по стабильному bid → варианты с флагами correct.
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, tpl.currentVersion)))
    .limit(1)
  if (!ver) return { error: 'not_found' }
  const [block] = await db
    .select({ content: steps.content })
    .from(steps)
    .where(and(eq(steps.versionId, ver.id), eq(steps.type, 'quiz'), sql`${steps.content}->>'bid' = ${bid}`))
    .limit(1)
  if (!block) return { error: 'not_found' }

  const content = block.content as { options?: { id: string; correct?: boolean }[]; multi?: boolean }
  const options = content.options ?? []
  const validIds = new Set(options.map((o) => o.id))
  // Отбрасываем неизвестные id (клиент мог прислать мусор), дедуплицируем.
  const picked = [...new Set(selectedIds)].filter((id) => validIds.has(id))
  const correctIds = options.filter((o) => o.correct).map((o) => o.id)
  if (!correctIds.length) return { error: 'no_answer' } // нельзя оценить без верных вариантов

  const correctSet = new Set(correctIds)
  const ok = picked.length === correctSet.size && picked.every((id) => correctSet.has(id))

  const [row] = await db
    .insert(quizAttempts)
    .values({ templateId, bid, userId: session.userId, selected: picked, correct: ok })
    .onConflictDoUpdate({
      target: [quizAttempts.userId, quizAttempts.templateId, quizAttempts.bid],
      set: { selected: picked, correct: ok, attempts: sql`${quizAttempts.attempts} + 1`, updatedAt: sql`now()` },
    })
    .returning({ attempts: quizAttempts.attempts })

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner) revalidatePath(`/${owner.handle}/${tpl.slug}`)

  return { ok, correctIds, attempts: row?.attempts ?? 1 }
}
