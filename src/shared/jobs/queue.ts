import 'server-only'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, jobs, type JobType } from '@/shared/db'
import { backoffMs } from './backoff'

export interface Job {
  id: string
  type: string
  payload: unknown
  attempts: number
  maxAttempts: number
  /** Сколько раз пробовали похоронить (только у задач из добора незакрытых похорон). */
  finalizeAttempts?: number
}

/** Поставить задачу в очередь. Это дешёвый insert — можно звать прямо из request-пути. */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  opts?: { maxAttempts?: number; delayMs?: number },
): Promise<void> {
  await db.insert(jobs).values({
    type,
    payload,
    maxAttempts: opts?.maxAttempts ?? 5,
    runAt: opts?.delayMs ? new Date(Date.now() + opts.delayMs) : new Date(),
  })
}

/**
 * Атомарно захватывает одну готовую задачу и переводит в processing.
 * `FOR UPDATE SKIP LOCKED` — параллельные воркеры/инстансы не берут одну задачу дважды.
 *
 * РУБИЛЬНИК ПЕТЕЛЬ живёт здесь, а не в каждом сервисе. Захват — единственное место,
 * через которое проходит ЛЮБАЯ фоновая работа, поэтому пауза из agent_loops действует
 * атомарно и сразу на все инстансы: остановленная петля просто не получает задач.
 * Проверка внутри сервиса такой гарантии не даёт — сервис уже запущен, и его ещё надо
 * уговорить остановиться.
 *
 * Ручная пауза (paused_at) и автоматический предохранитель (circuit_tripped_at) обе
 * блокируют выдачу; снимаются они по-разному, но эффект здесь один.
 */
export async function claimJob(): Promise<Job | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
        AND type NOT IN (
          SELECT type FROM agent_loops
          WHERE paused_at IS NOT NULL OR circuit_tripped_at IS NOT NULL
        )
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts, max_attempts
  `)
  const r = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
  if (!r) return null
  return {
    id: String(r.id),
    type: String(r.type),
    payload: r.payload,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
  }
}

/** Успех — задача выполнена. */
export async function completeJob(id: string): Promise<void> {
  await db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, id))
}

/**
 * Возвращает «зависшие» задачи (упавший посреди работы воркер оставил их в
 * `processing`): либо снова в очередь (attempts < maxAttempts), либо в `failed`.
 * Без этого claim берёт только `pending`, и зависшая джоба терялась навсегда.
 *
 * Порог намеренно щедрый (дефолт 30 мин, env SETFORK_JOB_STALL_SEC): в мульти-инстанс
 * реапе НЕ должен переотдать ЖИВУЮ, но долгую джобу (sweep digest/gardener, refine с
 * web-search) второму воркеру — иначе двойное исполнение и двойной расход LLM. Порог
 * обязан превышать самый долгий хендлер; полноценное решение — heartbeat updated_at.
 */
/**
 * Порог «задача зависла», секунды. Экспортируется, потому что нужен не только
 * жнецу: долгий обработчик обязан укладываться в него САМ, иначе жнец переотдаст
 * живую задачу второму воркеру. Читать одну и ту же env в двух местах нельзя —
 * дефолты разъедутся, и разъедутся молча.
 */
export const jobStallSec = (): number => Number(process.env.SETFORK_JOB_STALL_SEC ?? 1800)

export async function reapStalledJobs(
  olderThanSec = jobStallSec(),
): Promise<{ reaped: number; abandoned: Job[] }> {
  // status — enum job_status: результат CASE имеет тип text и НЕ приводится к enum
  // неявно (одиночный литерал приводится, CASE — нет), поэтому явный ::job_status.
  const res = await db.execute(sql`
    UPDATE jobs
    SET status = (CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END)::job_status,
        run_at = now(),
        updated_at = now(),
        last_error = coalesce(last_error, 'reaped: stalled in processing')
    WHERE status = 'processing' AND updated_at < now() - (${olderThanSec}::int * interval '1 second')
    RETURNING id, type, payload, attempts, max_attempts, status
  `)
  const rows = (res as { rows?: Record<string, unknown>[] }).rows ?? []
  // ОКОНЧАТЕЛЬНО похороненные отдаём поимённо, а не числом. Воркер умер посреди работы —
  // значит хендлер до своего finally не дошёл, и состояние фичи осталось «в процессе»
  // НАВСЕГДА: генерация висит в 'pending', то есть на экране вечный спиннер. Таблица задач
  // о смерти знает, фича — нет; связывает их финализатор в worker.
  return {
    reaped: rows.length,
    abandoned: rows.flatMap((r) =>
      String(r.status) === 'failed'
        ? [
            {
              id: String(r.id),
              type: String(r.type),
              payload: r.payload,
              attempts: Number(r.attempts),
              maxAttempts: Number(r.max_attempts),
            },
          ]
        : [],
    ),
  }
}

/**
 * Сколько раз пробуем похоронить, прежде чем сдаться. Предел обязателен: без него стабильно
 * падающий финализатор перезывался бы каждую минуту вечно. Тот же приём в зрелых очередях —
 * Oban Lifeline метит задачу с исчерпанными попытками 'discarded', River rescuer отбрасывает
 * её по максимуму попыток.
 */
const FINALIZE_MAX_ATTEMPTS = Math.max(1, Number(process.env.SETFORK_JOB_FINALIZE_ATTEMPTS) || 5)

/**
 * Забирает умерших, чьи похороны ещё не состоялись: финализатор не вызывался или упал.
 *
 * Быстрый путь (позвать финализатор сразу после смерти задачи) переживает не всё: база могла
 * моргнуть, процесс — умереть между пометкой 'failed' и вызовом. Reaper тут не поможет, он
 * смотрит только 'processing'. Поэтому воркер периодически добирает отсюда — пока похороны не
 * отметятся в `finalized_at` либо не кончатся попытки.
 *
 * Захват сделан UPDATE ... RETURNING с `FOR UPDATE SKIP LOCKED` — как в `claimJob`, и по той же
 * причине: инстансов несколько, и простой SELECT отдал бы одни и те же строки всем сразу.
 * Счётчик растёт В МОМЕНТ ЗАХВАТА, а не после неудачи: иначе смерть процесса прямо здесь не
 * оставляла бы следа, и задача возвращалась бы бесконечно.
 *
 * `types` — только те, у кого финализатор есть: остальные в выборке не копятся. Свежие первыми:
 * их «в процессе» человек видит прямо сейчас.
 */
export async function claimUnfinalizedJobs(types: string[], limit = 25): Promise<Job[]> {
  if (!types.length) return []
  const res = await db.execute(sql`
    UPDATE jobs SET finalize_attempts = finalize_attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'failed' AND finalized_at IS NULL
        AND type = any(${sql.param(types)}::text[])
        AND finalize_attempts < ${FINALIZE_MAX_ATTEMPTS}
      ORDER BY updated_at DESC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, type, payload, attempts, max_attempts, finalize_attempts
  `)
  const rows = (res as { rows?: Record<string, unknown>[] }).rows ?? []
  return rows.map((r) => ({
    id: String(r.id),
    type: String(r.type),
    payload: r.payload,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    finalizeAttempts: Number(r.finalize_attempts),
  }))
}

/** Попытки похоронить исчерпаны — это уже не «подождём следующего прохода», а тревога. */
export function finalizeExhausted(job: Job): boolean {
  return (job.finalizeAttempts ?? 0) >= FINALIZE_MAX_ATTEMPTS
}

/** Похороны состоялись — больше эту задачу финализатору не предлагаем. */
export async function markFinalized(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.update(jobs).set({ finalizedAt: new Date() }).where(inArray(jobs.id, ids))
}

/**
 * Ошибка — ретрай с backoff, либо `failed` после исчерпания попыток (attempts уже инкрементнут
 * в claim). Возвращает true, когда попытки кончились: по этому признаку воркер зовёт
 * финализатор типа задачи — иначе об окончательной смерти не знает никто, кроме таблицы.
 */
export async function failJob(job: Job, error: string): Promise<boolean> {
  const permanent = job.attempts >= job.maxAttempts
  await db
    .update(jobs)
    .set({
      status: permanent ? 'failed' : 'pending',
      runAt: permanent ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: error.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id))
  return permanent
}
