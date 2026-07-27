import 'server-only'
import { desc, eq, sql } from 'drizzle-orm'
import { agentActions, db } from '@/shared/db'

/**
 * ДЕТЕКТОР ХОЛОСТОГО ХОДА (5.5) — «петля работает, но ничего не происходит».
 *
 * Взято у Magentic-One: их progress-ledger на каждом такте отвечает на три вопроса —
 * «задача решена?», «прогресс есть?», «мы в петле?» — и при счётчике стагнаций делает
 * принудительный реплан. Идея точная, но их реализация тратит вызов модели на каждый такт.
 * У нас на это отвечает ЖУРНАЛ: он уже пишет каждое действие с результатом, поэтому
 * «прогресса нет» считается запросом, а не спрашиванием у модели.
 *
 * Что считается прогрессом: список создан, улучшен, опубликован, расхождение форком. Что НЕ
 * считается: «устоялся», «оставлено человеку», «пропущено», сухой прогон. Разница именно в
 * том, изменилось ли что-нибудь в библиотеке.
 *
 * Зачем: у петли ухода есть законный режим «улучшать нечего» — и это НЕ поломка, а сигнал к
 * расхождению форком. Но если проходы идут, деньги тратятся, а библиотека не меняется много
 * проходов подряд — это холостой ход, и владелец должен об этом узнать РАНЬШЕ, чем из счёта
 * за модель. Предохранитель здесь не рвём: платит петля не за ошибку, а за впустую сделанную
 * работу, и решать, менять ли настройки, человеку.
 */

/** Действия, которые считаются прогрессом: после них библиотека ДРУГАЯ. */
const PROGRESS = ['list.draft', 'list.improve', 'list.publish', 'list.fork'] as const

/** Сколько последних записей смотрим. Больше — дольше «помним» давний прогресс. */
const WINDOW = 12

export interface StallReport {
  /** Записей в окне (меньше окна — петля только начала работать). */
  seen: number
  /** Сколько из них — реальный прогресс. */
  progress: number
  /** Сколько действий прошло с последнего прогресса. 0 — прогресс есть прямо сейчас. */
  sinceProgress: number
  /** Холостой ход: записи есть, прогресса в окне нет вовсе. */
  stalled: boolean
}

/**
 * Отчёт о холостом ходе петли по журналу. Только SELECT, никаких вызовов модели.
 * Сухой прогон исключаем: там действий и не должно быть, иначе «наблюдение» читалось бы
 * как поломка.
 */
export async function stallReport(loop: string, window = WINDOW): Promise<StallReport> {
  const rows = await db
    .select({ action: agentActions.action, status: agentActions.resultStatus })
    .from(agentActions)
    .where(sql`${agentActions.loop} = ${loop} and ${agentActions.resultStatus} <> 'dry-run'`)
    .orderBy(desc(agentActions.occurredAt))
    .limit(window)

  const isProgress = (a: string, s: string) => (PROGRESS as readonly string[]).includes(a) && s === 'ok'
  let sinceProgress = 0
  let progress = 0
  let found = false
  for (const r of rows) {
    if (isProgress(r.action, r.status)) {
      progress++
      found = true
    } else if (!found) {
      sinceProgress++
    }
  }
  return { seen: rows.length, progress, sinceProgress, stalled: rows.length > 0 && progress === 0 }
}

/** Все петли разом — для дашборда. */
export async function stallReports(loops: readonly string[]): Promise<Record<string, StallReport>> {
  const out: Record<string, StallReport> = {}
  for (const l of loops) out[l] = await stallReport(l)
  return out
}

/** Есть ли в журнале хоть одна запись петли (иначе «холостого хода» не бывает — работы не было). */
export async function hasActions(loop: string): Promise<boolean> {
  const [row] = await db.select({ id: agentActions.id }).from(agentActions).where(eq(agentActions.loop, loop)).limit(1)
  return !!row
}
