import 'server-only'
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { db, jobs, templates, users } from '@/shared/db'
import type { Job } from '@/shared/jobs/queue'
import { captureError, log } from '@/shared/observability'
import { envNumber } from '@/shared/env'
import { MIRROR_BACKOFF_MS, MIRROR_MAX_BACKOFF_MS, mirrorRetryDueAt } from './mirror-policy'
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
 * ПОВТОРЫ НЕ КОНЧАЮТСЯ, пауза растёт до суток — почему именно так и что здесь
 * было раньше, см. `mirror-policy` (коротко: половина причин чинится на стороне
 * форджи без нашего участия, а цена вечных попыток на потолке — один запрос в
 * сутки; у Gitea отключения нет вовсе). Счётчик неудач ведёт ядро там же, где
 * пишет статус, и обнуляет его успехом.
 */

/** Как часто подметаем. */
const SWEEP_MS = envNumber('SETFORK_MIRROR_SWEEP_MIN', 5) * 60_000
/** Потолок зеркал за один проход: очередь чинит, а не устраивает шторм. */
const BATCH = envNumber('SETFORK_MIRROR_SWEEP_BATCH', 50)
/** Сколько раз на старте пробуем завести цепочку и с какой паузой. */
const ENSURE_ATTEMPTS = envNumber('SETFORK_MIRROR_ENSURE_ATTEMPTS', 5)
const ENSURE_RETRY_MS = envNumber('SETFORK_MIRROR_ENSURE_RETRY_SEC', 30) * 1000

/** Кандидат на повтор: столько, сколько нужно для решения «пора или нет». */
export type MirrorCandidate = { attempts: number; syncedAt: Date | null }

/**
 * Кого из кандидатов пора трогать — та же лестница пауз, что в `mirror-policy`,
 * но на языке SQL.
 *
 * ⚠️ Отбор обязан быть В ЗАПРОСЕ, а не после него. Сначала было наоборот —
 * «взять пачку и отфильтровать в JS», — и авто-ревью нашло, чем это кончается:
 * пачку забивают недозревшие. Полсотни зеркал, упавших давно и ждущих суточной
 * паузы, вытесняют одно, которое упало двадцать минут назад и уже готово; проход
 * возвращается, не починив ничего, и так каждый раз. Отбор в SQL + сортировка по
 * времени ГОТОВНОСТИ (а не по времени последней попытки) снимают это целиком.
 *
 * Числа берутся из `mirror-policy` — арифметика записана дважды, но значения
 * живут в одном месте. Тестом это связано в `mirror-sweep.itest.ts`: там
 * настоящая Postgres и проверка, что запрос выбирает ровно тех, кого называет
 * `mirrorRetryDueAt`.
 */
const dueAtSql = sql<Date>`${templates.mirrorSyncedAt} + least(
  make_interval(secs => ${MIRROR_BACKOFF_MS / 1000} * power(2, greatest(${templates.mirrorAttempts} - 1, 0))),
  make_interval(secs => ${MIRROR_MAX_BACKOFF_MS / 1000})
)`

/**
 * «Пора»: пауза вышла либо пуша не было ни разу.
 *
 * ⚠️ Скобки обязательны и не для красоты. `and(...)` склеивает условия через
 * `AND`, а он связывает крепче `OR` — без скобок весь отбор превращался в
 * «(есть url И есть ошибка И пуша не было) ИЛИ пауза вышла», то есть под второе
 * плечо попадало ЛЮБОЕ зеркало, включая исправное. Интеграционный тест
 * («исправное зеркало не трогаем») поймал это сразу.
 */
const dueSql = sql`(${templates.mirrorSyncedAt} is null or ${dueAtSql} <= now())`

/**
 * Тот же вопрос без базы — для интерфейса и тестов. Оставлен потому, что
 * настройки называют владельцу время следующей попытки, и оно обязано совпадать
 * с тем, когда подметальщик реально придёт.
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
  const due = await db
    .select({
      id: templates.id,
      slug: templates.slug,
      handle: users.handle,
      attempts: templates.mirrorAttempts,
      syncedAt: templates.mirrorSyncedAt,
    })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(and(isNotNull(templates.mirrorUrl), isNotNull(templates.mirrorError), dueSql))
    // Кто дольше ЖДЁТ СВОЕЙ ОЧЕРЕДИ — первым, то есть по времени готовности, а
    // не по времени последней попытки.
    .orderBy(asc(dueAtSql))
    .limit(BATCH)

  if (!due.length) return
  log.info('mirror.sweep', { due: due.length })
  for (const r of due) {
    // Последовательно, а не Promise.all: это фон, спешить некуда, а пачка
    // одновременных пушей — ровно та нагрузка, от которой ядро схлопывает свои.
    const res = await pushListMirror(r.handle, r.slug)
    if (!res.ok) log.warn('mirror.retry.failed', { templateId: r.id, attempt: r.attempts + 1, error: res.error })
  }
}

/**
 * Задача очереди. Самоподдерживающаяся: в конце ставит следующий проход.
 */
export async function runMirrorJob(_payload: unknown, job?: Job): Promise<void> {
  try {
    await sweepFailedMirrors()
  } catch (e) {
    // Сбой самого прохода — не повод ронять задачу в ретраи очереди: следующий
    // проход и так по расписанию, а зеркало ничего не потеряло.
    captureError(e, { where: 'mirror.sweep' })
  }
  // А вот постановка ПРЕЕМНИКА — вне try, и её ошибку глотать нельзя. Это
  // единственное звено, которым держится вся цепочка: проглоти её, и задача
  // завершится «успешно», не оставив после себя ничего, — повторы зеркал молча
  // прекратятся до следующего рестарта процесса. Пусть падает: долговечная
  // очередь повторит задачу с backoff и поставит преемника.
  //
  // `exceptJobId` — это МЫ САМИ: на момент вызова наша задача ещё `processing`,
  // и без исключения себя из проверки мы бы решили, что преемник уже есть.
  await ensureMirrorSweepScheduled({ delayMs: SWEEP_MS, exceptJobId: job?.id })
}

/**
 * Ключ advisory-локи «единственный подметальщик зеркал». Значение произвольное,
 * но ПОСТОЯННОЕ и уникальное в проекте: advisory-локи Postgres различаются
 * только числом, и совпадение с чужим ключом означало бы, что два несвязанных
 * места ждут друг друга без всякой причины. Заводя новую локу, бери следующее.
 */
const SWEEP_LOCK_KEY = 0x5f_00_01

/**
 * Обеспечить, что подметальщик заведён — ровно один. ЕДИНСТВЕННЫЙ способ
 * поставить задачу `mirror`: и на старте процесса, и как преемник в конце
 * прохода.
 *
 * Почему обе точки постановки — одна функция. Цепочка держится на том, что
 * задача перед завершением ставит следующую, и пока это была голая вставка,
 * дубли получались двумя разными способами:
 *
 *   * НА СТАРТЕ: при выкатке два инстанса поднимаются одновременно, оба видят
 *     «пусто» и оба заводят цепочку. Дальше они живут вечно и параллельно;
 *   * У ПРЕЕМНИКА: воркер умер (или `completeJob` не прошёл) уже ПОСЛЕ вставки —
 *     жнец возвращает задачу в `pending`, она исполняется снова и ставит ещё
 *     одного преемника. Каждый такой случай навсегда удваивает частоту проходов
 *     (авто-ревью fe#645, второй заход).
 *
 * Лечится одинаково: проверка «нет ли уже» и вставка идут АТОМАРНО, под
 * advisory-локой на время транзакции. Кто локу не получил — уходит, зная, что
 * этим уже занимаются.
 *
 * Учитываем и `processing`, а не только `pending`: рестарт во время прохода —
 * обычное дело при деплое, и без этого он тоже плодил бы вторую цепочку.
 *
 * @param exceptJobId — не считать за преемника ЭТУ задачу. Нужен вызову из
 * самого прохода: на тот момент он ещё `processing` и иначе принял бы себя за
 * уже поставленного преемника, оборвав цепочку.
 *
 * Ошибки НЕ глотает: у обоих вызывающих есть чем на них ответить.
 */
export async function ensureMirrorSweepScheduled(
  opts: { delayMs?: number; exceptJobId?: string } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx.execute(sql`select pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) as locked`)
    const locked = (res as { rows?: { locked?: boolean }[] }).rows?.[0]?.locked
    if (!locked) return // кто-то другой уже заводит — второй экземпляр не нужен
    const [dup] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, 'mirror'),
          inArray(jobs.status, ['pending', 'processing']),
          ...(opts.exceptJobId ? [ne(jobs.id, opts.exceptJobId)] : []),
        ),
      )
      .limit(1)
    if (dup) return
    await tx.insert(jobs).values({
      type: 'mirror',
      payload: {},
      runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
    })
  })
}

/**
 * Старт процесса: завести цепочку, если её нет.
 *
 * С повторами, потому что это единственная точка, откуда цепочка рождается: если
 * база моргнула ровно в эту секунду и мы просто запишем ошибку в лог, повторов
 * зеркал не будет ДО СЛЕДУЮЩЕГО РЕСТАРТА процесса — то есть, возможно, неделями
 * (авто-ревью fe#645). Пробрасывать ошибку выше бессмысленно: там её тоже некому
 * обработать, кроме лога.
 *
 * Попытки редкие и конечные: база, не поднявшаяся за эти минуты, — уже не
 * моргание, и тогда неработающие зеркала не самая большая беда, но в логе об
 * этом сказано прямо.
 */
export async function startMirrorSweepChain(): Promise<void> {
  for (let attempt = 1; attempt <= ENSURE_ATTEMPTS; attempt++) {
    try {
      await ensureMirrorSweepScheduled()
      return
    } catch (e) {
      captureError(e, { where: 'mirror.ensure', attempt })
      if (attempt === ENSURE_ATTEMPTS) {
        log.error('mirror.ensure.gaveup', {
          attempts: attempt,
          note: 'повторы зеркал не заведены — цепочка появится только при следующем старте',
        })
        return
      }
      await new Promise((r) => setTimeout(r, ENSURE_RETRY_MS))
    }
  }
}
