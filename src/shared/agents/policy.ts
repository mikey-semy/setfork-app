import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { agentActions, agentLoops, db } from '@/shared/db'
import { log } from '@/shared/observability'

/**
 * ФУНДАМЕНТ АВТОНОМИИ: политика петли + журнал её действий.
 *
 * Зачем именно сейчас: с появлением самогенерации петля начала тратить деньги БЕЗ
 * человека, а остановить можно было только весь ИИ разом или сайт целиком. Здесь то,
 * чего не хватало: пауза на одну петлю, сухой прогон, автоматический предохранитель и
 * след «сигнал → решение → действие → результат».
 *
 * Сам рубильник применяется в claimJob (shared/jobs/queue.ts) — там единственная точка,
 * через которую проходит любая фоновая работа.
 */

/** Петли, которые работают сами. Ключ = JobType, чтобы claimJob фильтровал без маппинга. */
export const AUTONOMOUS_LOOPS = ['gardener', 'selfgen', 'triples', 'linkcheck', 'digest', 'feedpull', 'changelog'] as const
export type LoopName = (typeof AUTONOMOUS_LOOPS)[number]

export interface LoopPolicy {
  type: string
  paused: boolean
  pauseReason: string
  dryRun: boolean
  circuitTripped: boolean
  circuitReason: string
  policyVersion: number
}

const DEFAULT_POLICY = (type: string): LoopPolicy => ({
  type,
  paused: false,
  pauseReason: '',
  dryRun: false,
  circuitTripped: false,
  circuitReason: '',
  policyVersion: 1,
})

/**
 * Политика петли. Нет строки — работаем по дефолту (не остановлены): отсутствие записи
 * НЕ должно останавливать существующие петли, иначе добавление этой таблицы молча
 * выключило бы садовника и рудник.
 */
export async function loopPolicy(type: string): Promise<LoopPolicy> {
  try {
    const [r] = await db.select().from(agentLoops).where(eq(agentLoops.type, type)).limit(1)
    if (!r) return DEFAULT_POLICY(type)
    return {
      type: r.type,
      paused: r.pausedAt != null,
      pauseReason: r.pauseReason,
      dryRun: r.dryRun,
      circuitTripped: r.circuitTrippedAt != null,
      circuitReason: r.circuitReason,
      policyVersion: r.policyVersion,
    }
  } catch (e) {
    log.warn?.('loopPolicy failed, using default', { type, err: e instanceof Error ? e.message : String(e) })
    return DEFAULT_POLICY(type)
  }
}

/** Все политики для админки — включая петли, у которых строки ещё нет. */
export async function allLoopPolicies(): Promise<LoopPolicy[]> {
  const rows = await db.select().from(agentLoops)
  const byType = new Map(rows.map((r) => [r.type, r]))
  return AUTONOMOUS_LOOPS.map((type) => {
    const r = byType.get(type)
    if (!r) return DEFAULT_POLICY(type)
    return {
      type,
      paused: r.pausedAt != null,
      pauseReason: r.pauseReason,
      dryRun: r.dryRun,
      circuitTripped: r.circuitTrippedAt != null,
      circuitReason: r.circuitReason,
      policyVersion: r.policyVersion,
    }
  })
}

/** Остановить петлю (ручной рубильник). Задачи этого типа перестают выдаваться воркеру. */
export async function pauseLoop(type: string, byUserId: string, reason = ''): Promise<void> {
  await db
    .insert(agentLoops)
    .values({ type, pausedAt: new Date(), pausedBy: byUserId, pauseReason: reason.slice(0, 300) })
    .onConflictDoUpdate({
      target: agentLoops.type,
      set: { pausedAt: new Date(), pausedBy: byUserId, pauseReason: reason.slice(0, 300), updatedAt: new Date() },
    })
  log.info('loop paused', { type, reason })
}

/** Снять ручную паузу. Автоматический предохранитель этим НЕ снимается — он отдельно. */
export async function resumeLoop(type: string): Promise<void> {
  await db
    .insert(agentLoops)
    .values({ type })
    .onConflictDoUpdate({ target: agentLoops.type, set: { pausedAt: null, pausedBy: null, pauseReason: '', updatedAt: new Date() } })
  log.info('loop resumed', { type })
}

/** Включить/выключить сухой прогон: петля считает и пишет журнал, но не действует. */
export async function setLoopDryRun(type: string, dryRun: boolean): Promise<void> {
  await db
    .insert(agentLoops)
    .values({ type, dryRun })
    .onConflictDoUpdate({ target: agentLoops.type, set: { dryRun, policyVersion: sql`${agentLoops.policyVersion} + 1`, updatedAt: new Date() } })
}

/**
 * Сорвать предохранитель — автоматически, из самой петли, когда что-то пошло не так
 * (скорость расхода, серия ошибок). Отличается от паузы тем, что ставит его КОД, а
 * снимает человек, разобравшись: молча самовосстанавливаться такой сигнал не должен.
 */
export async function tripCircuit(type: string, reason: string): Promise<void> {
  await db
    .insert(agentLoops)
    .values({ type, circuitTrippedAt: new Date(), circuitReason: reason.slice(0, 300) })
    .onConflictDoUpdate({
      target: agentLoops.type,
      set: { circuitTrippedAt: new Date(), circuitReason: reason.slice(0, 300), updatedAt: new Date() },
    })
  log.warn?.('loop circuit tripped', { type, reason })
}

/** Снять предохранитель (человек разобрался). */
export async function resetCircuit(type: string): Promise<void> {
  await db
    .insert(agentLoops)
    .values({ type })
    // circuitResetAt — ГРАНИЦА: всё, что записано до неё, к нынешнему состоянию петли
    // не относится. Иначе человек снимает предохранитель, а прежние пять ошибок
    // по-прежнему последние — и он срывается снова, не дав петле ни одного прохода.
    .onConflictDoUpdate({
      target: agentLoops.type,
      set: { circuitTrippedAt: null, circuitReason: '', circuitResetAt: new Date(), updatedAt: new Date() },
    })
}

export interface AgentActionInput {
  loop: string
  action: string
  resultStatus: 'ok' | 'skipped' | 'error' | 'dry-run'
  actorUserId?: string | null
  agentId?: string
  principalMode?: 'autonomous' | 'on_behalf_of'
  signal?: Record<string, unknown>
  decision?: Record<string, unknown>
  resultRef?: string
  error?: string
  policyVersion?: number
  /** Задан → повторная запись с тем же ключом отбрасывается (уникальный индекс). */
  idempotencyKey?: string
}

/**
 * Записать действие в журнал. Возвращает false, если такое действие уже записано
 * (сработал ключ идемпотентности) — вызывающий может по этому понять «уже делали».
 *
 * Журнал не должен ронять работу: сбой записи логируем, но наверх не бросаем — кроме
 * случая дубля, который как раз является значимым ответом.
 */
export async function recordAgentAction(input: AgentActionInput): Promise<boolean> {
  try {
    const inserted = await db
      .insert(agentActions)
      .values({
        loop: input.loop,
        action: input.action,
        resultStatus: input.resultStatus,
        actorUserId: input.actorUserId ?? null,
        agentId: input.agentId ?? '',
        principalMode: input.principalMode ?? 'autonomous',
        signal: input.signal ?? {},
        decision: input.decision ?? {},
        resultRef: (input.resultRef ?? '').slice(0, 300),
        error: (input.error ?? '').slice(0, 500),
        policyVersion: input.policyVersion ?? 1,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .onConflictDoNothing({ target: agentActions.idempotencyKey })
      .returning({ id: agentActions.id })
    return inserted.length > 0
  } catch (e) {
    log.warn?.('recordAgentAction failed', { loop: input.loop, err: e instanceof Error ? e.message : String(e) })
    return true // не блокируем работу из-за журнала
  }
}
