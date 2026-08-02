import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
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
    UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = now(), heartbeat_at = now()
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

/**
 * Успех — задача выполнена.
 *
 * Номер попытки в WHERE по той же причине, что и у пульса: обработчик мог пережить собственную
 * попытку. Три пропущенных удара подряд (пауза event loop, насыщение пула) — и reaper вернул
 * задачу в очередь, а её уже захватил другой воркер. Наш «успех» в этот момент пометил бы
 * `done` работу, которая идёт прямо сейчас, и её результат пропал бы.
 */
export async function completeJob(id: string, attempt?: number): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', updatedAt: new Date() })
    .where(attempt === undefined ? eq(jobs.id, id) : and(eq(jobs.id, id), eq(jobs.attempts, attempt)))
}

/**
 * Пульс: «я ещё жив и держу эту задачу». Зовётся по таймеру, пока идёт обработка.
 *
 * `updated_at` НЕ трогаем намеренно: он про изменение самой задачи, и по нему считают возраст
 * в других местах. Пульс — отдельное поле, иначе живая долгая задача выглядела бы вечно юной.
 *
 * УСЛОВИЯ В WHERE — не украшение, а две гонки подряд (обе от авто-ревью по #648).
 * `clearInterval` отменяет будущие удары, но НЕ отзывает уже улетевший UPDATE:
 *
 *  - он мог приземлиться после того, как задачу вернули в очередь → `status = 'processing'`;
 *  - а если за это время её успели перезахватить, статус снова 'processing', и удар от ПРОШЛОЙ
 *    попытки продлил бы жизнь ЧУЖОЙ → сверяем ещё и номер попытки.
 *
 * Postgres в READ COMMITTED перепроверяет предикат после ожидания блокировки, поэтому
 * опоздавший удар просто не находит строку и тихо ничего не делает.
 */
export async function touchJob(id: string, attempt: number): Promise<void> {
  await db
    .update(jobs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'processing'), eq(jobs.attempts, attempt)))
}

/**
 * Возвращает «зависшие» задачи (упавший посреди работы воркер оставил их в
 * `processing`): либо снова в очередь (attempts < maxAttempts), либо в `failed`.
 * Без этого claim берёт только `pending`, и зависшая джоба терялась навсегда.
 *
 * ДВА ПОРОГА, и это главное здесь. Задача с пульсом (её держит воркер этой версии) считается
 * мёртвой через SETFORK_JOB_HEARTBEAT_STALL_SEC — по умолчанию минуту: пульс бьётся раз в 15с,
 * три пропуска подряд означают, что процесса больше нет. Задача БЕЗ пульса — взятая версией без
 * heartbeat или переживающая выкатку — судится по-старому, щедрым SETFORK_JOB_STALL_SEC (30 мин).
 *
 * Щедрый порог был вынужденным: reaper не должен переотдать ЖИВУЮ, но долгую задачу (совет ≈ 9.5
 * вызовов модели, sweep gardener) второму воркеру — это двойное исполнение и двойной расход LLM.
 * Пульс снимает выбор между «быстро замечаем смерть» и «не отбираем живое»: долгая задача дышит.
 */
export async function reapStalledJobs(
  olderThanSec = Number(process.env.SETFORK_JOB_STALL_SEC ?? 1800),
  heartbeatStallSec = Number(process.env.SETFORK_JOB_HEARTBEAT_STALL_SEC ?? 60),
): Promise<{ reaped: number; abandoned: Job[] }> {
  // status — enum job_status: результат CASE имеет тип text и НЕ приводится к enum
  // неявно (одиночный литерал приводится, CASE — нет), поэтому явный ::job_status.
  const res = await db.execute(sql`
    UPDATE jobs
    SET status = (CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END)::job_status,
        run_at = now(),
        updated_at = now(),
        -- ПУЛЬС ГАСИМ, отпуская задачу. Иначе он остался бы от прошлого исполнителя, и
        -- следующую попытку — вдруг её возьмёт воркер прежней версии, который пульса не
        -- бьёт, — судили бы по короткому порогу: через минуту живую работу отобрали бы
        -- второй раз (двойной расход на моделях). Пустой пульс = «судить щедро», и это
        -- ровно то, что нужно, пока задачу не подхватит воркер, умеющий дышать.
        heartbeat_at = NULL,
        last_error = coalesce(last_error, 'reaped: stalled in processing')
    WHERE status = 'processing'
      AND (
        CASE
          WHEN heartbeat_at IS NOT NULL THEN heartbeat_at < now() - (${heartbeatStallSec}::int * interval '1 second')
          ELSE updated_at < now() - (${olderThanSec}::int * interval '1 second')
        END
      )
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
  const res = await db
    .update(jobs)
    .set({
      status: permanent ? 'failed' : 'pending',
      runAt: permanent ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: error.slice(0, 1000),
      updatedAt: new Date(),
      // Отпускаем задачу — гасим пульс (см. reapStalledJobs): чужой старый пульс на новой
      // попытке заставил бы reaper судить её по минутному порогу и отобрать живую работу.
      heartbeatAt: null,
    })
    // Номер попытки — как в completeJob: пережившая себя попытка не должна объявлять исход за
    // ту, что идёт сейчас. Промах здесь ВАЖЕН и возвращается наверх: без него воркер позвал бы
    // финализатор и закрыл живую работу как брошенную.
    .where(and(eq(jobs.id, job.id), eq(jobs.attempts, job.attempts)))
    .returning({ id: jobs.id })
  return permanent && res.length > 0
}

/**
 * Уборка терминальных задач — таблица очереди не архив.
 *
 * У River на это отдельный job cleaner с разной выдержкой по исходу: успешные удаляются через
 * сутки, отброшенные живут неделю. Логика та же и здесь: успех через день уже никому не
 * интересен, а вот провал — это то, по чему разбирают инцидент, и выкидывать его назавтра
 * нельзя. Обе выдержки — env, потому что «сутки» и «неделя» это не законы природы.
 *
 * УМЕРШИЕ БЕЗ ПОХОРОН НЕ ТРОГАЕМ — но только там, где похороны вообще положены. Строка
 * `failed` с пустым `finalized_at` у типа С финализатором — это не мусор, а невыполненная
 * работа: её ждёт добор финализации, и удалив её, мы бы своими руками вернули вечный спиннер
 * из #637. А вот у типов БЕЗ финализатора (`email`, `push`, `reindex`…) `finalized_at` пуст
 * всегда и по определению — требовать его от них значило бы не удалять их провалы никогда,
 * то есть отменить смысл уборки для большинства таблицы (находка авто-ревью по #648).
 * Поэтому список типов приходит снаружи: реестр финализаторов знает воркер, не очередь.
 *
 * `limit` держит проход коротким: удалять миллион строк одним DELETE — это долгая блокировка
 * на горячей таблице, из-за которой встанут все воркеры.
 */
export async function cleanupTerminalJobs(
  finalizedTypes: string[] = [],
  doneAfterHours = Number(process.env.SETFORK_JOB_RETAIN_DONE_H ?? 24),
  failedAfterDays = Number(process.env.SETFORK_JOB_RETAIN_FAILED_D ?? 7),
  limit = 5000,
): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM jobs WHERE id IN (
      SELECT id FROM jobs
      WHERE (status = 'done' AND updated_at < now() - (${doneAfterHours}::int * interval '1 hour'))
         OR (
              status = 'failed'
              AND updated_at < now() - (${failedAfterDays}::int * interval '1 day')
              AND (finalized_at IS NOT NULL OR NOT (type = any(${sql.param(finalizedTypes)}::text[])))
            )
      LIMIT ${limit}
    )
    RETURNING id
  `)
  return (res as { rows?: unknown[] }).rows?.length ?? 0
}
