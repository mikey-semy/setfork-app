import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { courseCompletions, db, quizAttempts, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

export interface LeaderboardEntry {
  handle: string
  name: string | null
  avatarUrl: string | null
  completedAt: Date
  version: number
}

/** Лидерборд курса: кто прошёл, в порядке завершения (раньше = выше). */
export async function getCourseLeaderboard(templateId: string): Promise<LeaderboardEntry[]> {
  return db
    .select({ handle: users.handle, name: users.name, avatarUrl: users.avatarUrl, completedAt: courseCompletions.completedAt, version: courseCompletions.version })
    .from(courseCompletions)
    .innerJoin(users, eq(users.id, courseCompletions.userId))
    .where(eq(courseCompletions.templateId, templateId))
    .orderBy(asc(courseCompletions.completedAt))
    .limit(100)
}

export interface QuizState {
  selected: string[] // что зритель выбрал в последней попытке ([] — не проходил)
  correct: boolean // прошёл ли
  attempts: number // сколько раз пробовал
  submitted: boolean // была ли хоть одна попытка (иначе виджет в исходном виде)
}

const EMPTY: QuizState = { selected: [], correct: false, attempts: 0, submitted: false }

/** Состояние quiz-блоков списка для текущего зрителя (последняя попытка по bid). */
/**
 * Состояние тестов для отрисовки. Отпечаток содержимого сверяется ТАК ЖЕ, как при
 * выдаче сертификата: иначе страница показывала бы отредактированный вопрос уже
 * пройденным (и открывала зависимые уроки), тогда как выдача требует пересдачи.
 * `current` — отпечатки текущих версий вопросов, ключ = bid.
 */
export async function getQuizState(
  templateId: string,
  bids: string[],
  userId?: string,
  current?: Map<string, string>,
): Promise<Record<string, QuizState>> {
  const out: Record<string, QuizState> = {}
  const uniq = [...new Set(bids)].filter(Boolean)
  for (const b of uniq) out[b] = { ...EMPTY }
  if (!uniq.length || !userId) return out

  const rows = await db
    .select({ bid: quizAttempts.bid, selected: quizAttempts.selected, correct: quizAttempts.correct, attempts: quizAttempts.attempts, hash: quizAttempts.contentHash })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.templateId, templateId), inArray(quizAttempts.bid, uniq), eq(quizAttempts.userId, userId)))
  for (const r of rows) {
    if (!out[r.bid]) continue
    out[r.bid] = { selected: r.selected ?? [], correct: r.correct, attempts: r.attempts, submitted: true }
  }
  return out
}

/** Факт прохождения курса пользователем (для CTA сертификата / профиля). */
export interface CourseCompletionRow {
  version: number
  completedAt: Date
  // Снимок фактов на момент выдачи; NULL у записей, сделанных до его появления.
  courseTitle: LocaleText | null
  courseSlug: string | null
  issuerHandle: string | null
  issuerName: string | null
  learnerHandle: string | null
  learnerName: string | null
}

/** Запись о прохождении вместе со СНИМКОМ фактов на момент выдачи. */
export async function getCourseCompletion(templateId: string, userId?: string): Promise<CourseCompletionRow | null> {
  if (!userId) return null
  const [row] = await db
    .select({
      version: courseCompletions.version,
      completedAt: courseCompletions.completedAt,
      courseTitle: courseCompletions.courseTitle,
      courseSlug: courseCompletions.courseSlug,
      issuerHandle: courseCompletions.issuerHandle,
      issuerName: courseCompletions.issuerName,
      learnerHandle: courseCompletions.learnerHandle,
      learnerName: courseCompletions.learnerName,
    })
    .from(courseCompletions)
    .where(and(eq(courseCompletions.userId, userId), eq(courseCompletions.templateId, templateId)))
    .limit(1)
  return row ?? null
}

/**
 * Мета курса для владельца СЕРТИФИКАТА, когда сам курс уже недоступен зрителю
 * (закрыт, снят модерацией). Документ о прохождении принадлежит человеку и не должен
 * исчезать вместе с доступом к списку, поэтому здесь видимость намеренно не проверяется —
 * но и отдаётся эта мета только тому, у кого есть запись о прохождении.
 */
export async function completionHolderMeta(
  ownerHandle: string,
  slug: string,
  userId?: string,
): Promise<{ id: string; title: LocaleText; ownerHandle: string; ownerName: string | null } | null> {
  if (!userId) return null

  // Курс ещё существует, но зрителю не виден (закрыт, снят модерацией) — берём его мету.
  const [live] = await db
    .select({ id: templates.id, title: templates.title, ownerHandle: users.handle, ownerName: users.name })
    .from(courseCompletions)
    .innerJoin(templates, eq(templates.id, courseCompletions.templateId))
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(and(eq(courseCompletions.userId, userId), eq(users.handle, ownerHandle), eq(templates.slug, slug)))
    .limit(1)
  if (live) return live

  // Курса больше нет: связь порвана (ON DELETE SET NULL), и join выше ничего не найдёт.
  // Именно ради этого случая и делался снимок — резолвим документ по нему.
  const [fromSnapshot] = await db
    .select({
      id: courseCompletions.id,
      title: courseCompletions.courseTitle,
      ownerHandle: courseCompletions.issuerHandle,
      ownerName: courseCompletions.issuerName,
    })
    .from(courseCompletions)
    .where(
      and(
        eq(courseCompletions.userId, userId),
        eq(courseCompletions.courseSlug, slug),
        eq(courseCompletions.issuerHandle, ownerHandle),
      ),
    )
    .limit(1)
  if (!fromSnapshot) return null
  return {
    id: fromSnapshot.id, // идентификатор записи о прохождении: живого курса уже нет
    title: fromSnapshot.title ?? {},
    ownerHandle: fromSnapshot.ownerHandle ?? ownerHandle,
    ownerName: fromSnapshot.ownerName,
  }
}
