import 'server-only'
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm'
import { db, jobs, templates, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { captureError, log } from '@/shared/observability'
import { envNumber } from '@/shared/env'
import { MIRROR_MAX_ATTEMPTS, mirrorRetryDueAt } from './mirror-policy'
import { pushListMirror } from './actions'

/**
 * Ф2: повторы упавшего пуша зеркала.
 *
 * Зачем вообще. Пуш зеркала — фоновый: его делает ядро после каждой записи в
 * main, и никто его не ждёт. Сеть моргнула, форджа полежала минуту, токен на
 * секунду отдал 500 — статус покраснел и лежал до следующей версии списка.
 * Владелец узнавал об этом, только если сам заходил в настройки. Для витрины и
 * резервной копии это ровно тот сбой, который обязан лечиться сам.
 *
 * ФОРМА — подметальщик, а не задача на каждое падение. В промпте фазы стояли два
 * других источника события, и оба выбраны не были:
 *   * «ставить из ответа MirrorPush» — фронт вызывает пуш только руками (кнопка,
 *     сохранение настроек). Фоновые пуши после каждого git-push и слияния идут
 *     мимо фронта целиком, а это их подавляющее большинство: чинилась бы
 *     наименее нужная часть;
 *   * «ставить при следующем чтении списка» — привязывает починку к тому, что
 *     кто-то откроет страницу. Зеркало редко читаемого списка чинилось бы
 *     никогда, а путь чтения начал бы писать в очередь.
 * Подметальщик не зависит ни от чьих визитов и заодно закрывает случай, который
 * ядро закрыть не может: перезапуск процесса внутри окна схлопывания теряет
 * отложенный пуш (см. setfork-core, src/throttle.rs).
 *
 * ЛИМИТ ПОПЫТОК. Отозванный токен и удалённый на фордже репозиторий не чинятся
 * повторами: пробовать вечно — это шуметь в чужой фордже и прятать от владельца
 * тот факт, что нужны его руки. После MIRROR_MAX_ATTEMPTS подряд повторы
 * прекращаются, и настройки говорят об этом прямым текстом. Счётчик обнуляет
 * успех — его ведёт ядро там же, где пишет статус.
 */

/** Как часто подметаем. */
const SWEEP_MS = envNumber('SETFORK_MIRROR_SWEEP_MIN', 5) * 60_000
/** Потолок зеркал за один проход: очередь чинит, а не устраивает шторм. */
const BATCH = envNumber('SETFORK_MIRROR_SWEEP_BATCH', 50)

/** Кандидат на повтор: столько, сколько нужно для решения «пора или нет». */
export type MirrorCandidate = { attempts: number; syncedAt: Date | null }

/**
 * Кого из кандидатов пора трогать. Отдельной функцией, потому что это и есть
 * решение — а решение обязано проверяться тестом без базы и без сети.
 *
 * Паузу считаем здесь, а не условием в SQL: формула та же, что показывает
 * владельцу время следующей попытки, и жить она обязана в ОДНОМ месте. Второй
 * экземпляр в SQL неизбежно разъехался бы, и настройки начали бы обещать одно
 * время, а подметальщик приходить в другое.
 */
export function dueMirrors<T extends MirrorCandidate>(candidates: T[], now: number): T[] {
  return candidates.filter((r) => mirrorRetryDueAt(r.attempts, r.syncedAt).getTime() <= now)
}

/**
 * Один проход: найти зеркала с ошибкой, у которых ещё остались попытки и прошла
 * пауза, и толкнуть пуш. Результат (успех или новая ошибка) пишет ядро — здесь
 * только повод повторить.
 */
export async function sweepFailedMirrors(): Promise<void> {
  const candidates = await db
    .select({
      id: templates.id,
      slug: templates.slug,
      handle: users.handle,
      attempts: templates.mirrorAttempts,
      syncedAt: templates.mirrorSyncedAt,
    })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(
      and(
        isNotNull(templates.mirrorUrl),
        isNotNull(templates.mirrorError),
        lt(templates.mirrorAttempts, MIRROR_MAX_ATTEMPTS),
      ),
    )
    // Кто дольше всех ждёт — первым; за потолок пачки уезжают самые свежие, они
    // и так не дозрели до повтора.
    .orderBy(asc(templates.mirrorSyncedAt))
    .limit(BATCH)

  const due = dueMirrors(candidates, Date.now())
  if (!due.length) return
  log.info('mirror.sweep', { due: due.length, candidates: candidates.length })
  for (const r of due) {
    // Последовательно, а не Promise.all: это фон, спешить некуда, а пачка
    // одновременных пушей — ровно та нагрузка, от которой ядро схлопывает свои.
    const res = await pushListMirror(r.handle, r.slug)
    if (!res.ok) log.warn('mirror.retry.failed', { templateId: r.id, attempt: r.attempts + 1, error: res.error })
  }
}

/**
 * Задача очереди. Самоподдерживающаяся: в конце ставит следующий проход —
 * так же, как changelog. Перепланируем ВСЕГДА, даже после падения: иначе одна
 * сетевая ошибка выключила бы починку зеркал до следующего рестарта.
 */
export async function runMirrorJob(): Promise<void> {
  try {
    await sweepFailedMirrors()
  } catch (e) {
    // Подметальщик — не бизнес-процесс: его сбой не должен уходить в ретраи
    // очереди с backoff, следующий проход и так по расписанию.
    captureError(e, { where: 'mirror.sweep' })
  } finally {
    await scheduleNextMirrorSweep()
  }
}

export async function scheduleNextMirrorSweep(): Promise<void> {
  await enqueueJob('mirror', {}, { delayMs: SWEEP_MS }).catch(() => {})
}

/**
 * Завести подметальщик на старте, если он ещё не заведён. Проверка на дубль
 * обязательна: задача самоподдерживающаяся, и без неё каждый рестарт добавлял бы
 * ещё один вечный проход — через месяц перезапусков зеркала подметались бы
 * десятками параллельных задач (тот же приём, что у changelog).
 */
export async function ensureMirrorSweepScheduled(): Promise<void> {
  try {
    const [dup] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, 'mirror'), eq(jobs.status, 'pending')))
      .limit(1)
    if (dup) return
    await enqueueJob('mirror', {})
  } catch (e) {
    captureError(e, { where: 'mirror.ensure' })
  }
}
