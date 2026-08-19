import 'server-only'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, runStepState, runs, steps } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { feedWindow } from '@/shared/lib/paging'

/** Опыт других прогонов шага для «помощи на шаге»: сколько прошло / застряло.
 *  Только счётчики (наш data moat) — чужие тексты причин НЕ выдаём (приватность note).
 *  excludeRunId — текущий прогон не считаем сам себе «опытом других». */
export async function stepStuckStats(stepId: string, excludeRunId: string): Promise<{ passed: number; stuck: number }> {
  const [row] = await db
    .select({
      passed: sql<number>`count(*) filter (where ${runStepState.status} = 'done')::int`,
      stuck: sql<number>`count(*) filter (where ${runStepState.status} = 'blocked')::int`,
    })
    .from(runStepState)
    .where(and(eq(runStepState.stepId, stepId), ne(runStepState.runId, excludeRunId)))
  return { passed: row?.passed ?? 0, stuck: row?.stuck ?? 0 }
}

export interface UserRunRow {
  id: string
  status: 'active' | 'done' | 'abandoned' | 'failed'
  version: number
  doneCount: number
  total: number
  updatedAt: Date
  handle: string
  slug: string
  title: LocaleText
}

/** Статус прогона как вкладка страницы «Мои прогоны». */
export type RunStatus = 'active' | 'done' | 'abandoned'

/** Сколько прогонов у пользователя в каждом статусе — числа для вкладок. */
export async function countUserRunsByStatus(userId: string): Promise<Record<RunStatus, number>> {
  const rows = await db
    .select({ status: runs.status, n: sql<number>`count(*)::int` })
    .from(runs)
    .where(eq(runs.userId, userId))
    .groupBy(runs.status)
  const out: Record<RunStatus, number> = { active: 0, done: 0, abandoned: 0 }
  for (const r of rows) if (r.status in out) out[r.status as RunStatus] = r.n
  return out
}

/**
 * Прогоны пользователя ОДНОГО статуса, свежие сверху.
 *
 * Статус в ЗАПРОСЕ, а не в разметке, и это не мелочь. Страница показывала три раздела
 * сразу и делила полную выдачу в памяти — то есть поднимала все прогоны человека, сколько
 * бы их ни было. Со страницами такое деление вообще невозможно: страница могла бы
 * состоять из одних завершённых, и раздел «в процессе» выглядел бы пустым при живых
 * прогонах. Поэтому статус стал вкладкой, как у задач и правок.
 *
 * Оговорка про порядок: он идёт по `updatedAt`, а тот МЕНЯЕТСЯ — прогон, к которому
 * вернулись, переезжает наверх. Смещение от этого не спасает ничем (и курсор тоже:
 * keyset опирается на неизменность ключа). Для собственных прогонов это терпимо —
 * список меняет тот же человек, который его читает, — но если однажды окажется, что
 * строки теряются, лечится это сменой ключа на `createdAt`, а не механикой листания.
 */
export async function getUserRuns(
  userId: string,
  status?: RunStatus,
  /** Окно страницы. Проверяется `feedWindow`: битый предел драйвер выбрасывает молча. */
  window?: { limit: number; offset?: number },
): Promise<UserRunRow[]> {
  const w = window && feedWindow(window)
  const rows = await db.query.runs.findMany({
    where: (r, { and: a }) => (status ? a(eq(r.userId, userId), eq(r.status, status))! : eq(r.userId, userId)),
    with: { template: { with: { owner: true } } },
    // Доопределение до `id`: у пачки прогонов, тронутых одной операцией, время совпадает.
    orderBy: (r, { desc, asc }) => [desc(r.updatedAt), asc(r.id)],
    ...(w ? { limit: w.limit, offset: w.offset } : {}),
  })
  if (rows.length === 0) return []
  // Кол-во шагов в версиях прогонов — одним запросом (без relation `version`,
  // чтобы не конфликтовать с одноимённой колонкой runs.version).
  const versionIds = [...new Set(rows.map((r) => r.versionId))]
  // total = только шаг-блоки (чекаемые); text/image в прогрессе не считаются.
  const counts = await db
    .select({ versionId: steps.versionId, c: sql<number>`count(*)::int` })
    .from(steps)
    .where(and(inArray(steps.versionId, versionIds), eq(steps.type, 'step')))
    .groupBy(steps.versionId)
  const totalByVersion = new Map(counts.map((c) => [c.versionId, c.c]))
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    version: r.version,
    doneCount: r.doneCount,
    total: totalByVersion.get(r.versionId) ?? 0,
    updatedAt: r.updatedAt,
    handle: r.template.owner.handle,
    slug: r.template.slug,
    title: r.template.title as LocaleText,
  }))
}

/** Прогон со всеми шагами версии и их состоянием. Только владельцу прогона. */
export async function getRun(runId: string, userId: string) {
  const run = await db.query.runs.findFirst({
    where: (r) => eq(r.id, runId),
    with: {
      template: { with: { owner: true } },
      version: { with: { steps: { orderBy: (s, { asc }) => asc(s.n) } } },
      stepStates: true,
    },
  })
  if (!run || run.userId !== userId) return null

  const stateByStep = new Map(run.stepStates.map((s) => [s.stepId, s]))
  return {
    run: { id: run.id, status: run.status, doneCount: run.doneCount, version: run.version, templateId: run.templateId },
    template: {
      handle: run.template.owner.handle,
      slug: run.template.slug,
      title: run.template.title,
      ordered: run.template.ordered,
    },
    steps: run.version.steps.map((s) => ({
      id: s.id,
      n: s.n,
      type: s.type,
      content: s.content,
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      // Секция-урок: в прогоне не рендерится, но служит подписью блока без
      // заголовка в шапке чата раскопки (blockChatTitle).
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      state: stateByStep.get(s.id) ?? null,
    })),
  }
}

/** Активный прогон пользователя по текущей версии списка (для кнопки «Продолжить»). */
export async function getActiveRunId(templateId: string, versionId: string, userId: string): Promise<string | null> {
  const [r] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.userId, userId), eq(runs.templateId, templateId), eq(runs.versionId, versionId), eq(runs.status, 'active')),
    )
    .limit(1)
  return r?.id ?? null
}
