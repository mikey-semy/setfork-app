'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { courseCompletions, db, quizAttempts, steps, templates, templateVersions, users } from '@/shared/db'
import { recordCompletionIfDone } from '@/shared/completion'
import { quizContentHash } from '@/core/domain/quiz-fingerprint'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { gradeBlank, gradeMatch, gradeNumber, gradeSort, gradeText, quizKind, type QuizAnswer, type QuizBlockContent } from '@/core'

export interface QuizVerdict {
  ok: boolean // прошёл
  correctIds: string[] // верные варианты (choice) — раскрываются ТОЛЬКО после отправки
  reveal?: string // верный ответ (text/number) — раскрывается после отправки
  attempts: number // сколько попыток сделал (для UI «попытка N»)
  completed?: boolean // этой отправкой пройден ПОСЛЕДНИЙ тест → курс завершён
}

/** Отправка ответа на quiz-блок. Оценка на СЕРВЕРЕ (эталон берём из git-content
 *  текущей версии, а не с клиента). Поддержаны типы choice/text/number. Результат —
 *  одна строка на (user, tpl, bid), пересдача перезаписывает её и инкрементит attempts. */
export async function submitQuiz(templateId: string, bid: string, answer: QuizAnswer): Promise<QuizVerdict | { error: string }> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return { error: 'not_found' }
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'forbidden' }

  // Quiz-блок текущей версии по стабильному bid → эталонный ответ.
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

  const content = block.content as unknown as QuizBlockContent
  const kind = quizKind(content)
  let ok = false
  let selected: string[] = []
  let correctIds: string[] = []
  let reveal: string | undefined

  if (kind === 'text' || kind === 'code') {
    const accept = (content.accept ?? []).map((a) => String(a))
    if (!accept.length) return { error: 'no_answer' }
    const input = (answer.text ?? '').trim()
    selected = [input]
    ok = gradeText(input, accept, content.caseSensitive)
    reveal = accept.join(' / ')
  } else if (kind === 'sort') {
    const items = Array.isArray(content.items) ? content.items.map((s) => String(s)) : []
    if (!items.length) return { error: 'no_answer' }
    const order = (answer.order ?? []).map((s) => String(s))
    selected = order
    ok = gradeSort(order, items, content.caseSensitive)
    reveal = items.join(' → ')
  } else if (kind === 'number') {
    if (typeof content.answer !== 'number') return { error: 'no_answer' }
    const input = (answer.text ?? '').trim()
    selected = [input]
    ok = gradeNumber(Number(input), content.answer, content.tolerance)
    reveal = String(content.answer)
  } else if (kind === 'blank') {
    const blanks = Array.isArray(content.blanks) ? content.blanks : []
    if (!blanks.length) return { error: 'no_answer' }
    const inputs = (answer.blanks ?? []).map((s) => String(s))
    selected = inputs
    ok = gradeBlank(inputs, blanks, content.caseSensitive)
    reveal = blanks.map((b) => b[0] ?? '').join(', ')
  } else if (kind === 'match') {
    const pairs = Array.isArray(content.pairs) ? content.pairs : []
    if (!pairs.length) return { error: 'no_answer' }
    const assignment = (answer.match ?? []).map((s) => String(s))
    selected = assignment
    ok = gradeMatch(assignment, pairs, content.caseSensitive)
    reveal = pairs.map((p) => `${p.left} → ${p.right}`).join('; ')
  } else {
    const options = content.options ?? []
    const validIds = new Set(options.map((o) => o.id))
    selected = [...new Set(answer.options ?? [])].filter((id) => validIds.has(id))
    correctIds = options.filter((o) => o.correct).map((o) => o.id)
    if (!correctIds.length) return { error: 'no_answer' }
    const correctSet = new Set(correctIds)
    ok = selected.length === correctSet.size && selected.every((id) => correctSet.has(id))
  }

  const [row] = await db
    .insert(quizAttempts)
    .values({ templateId, bid, userId: session.userId, selected, correct: ok, contentHash: quizContentHash(content as unknown as Record<string, unknown>) })
    .onConflictDoUpdate({
      target: [quizAttempts.userId, quizAttempts.templateId, quizAttempts.bid],
      set: { selected, correct: ok, contentHash: quizContentHash(content as unknown as Record<string, unknown>), attempts: sql`${quizAttempts.attempts} + 1`, updatedAt: sql`now()` },
    })
    .returning({ attempts: quizAttempts.attempts })

  // Завершение курса — ОБЩЕЕ определение на оба пути (features/library/completion).
  // Своя копия здесь проверяла только тесты и не знала про шаг-блоки той же версии:
  // на смешанной версии сдача последнего теста выдавала прохождение, даже если ни один
  // обычный шаг не был отмечен. Симметричная дыра была у пути прогона.
  const completed = ok
    ? await recordCompletionIfDone(session.userId, { templateId, versionId: ver.id, version: tpl.currentVersion })
    : false

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner) revalidatePath(`/${owner.handle}/${tpl.slug}`)

  return { ok, correctIds, reveal, attempts: row?.attempts ?? 1, completed }
}
