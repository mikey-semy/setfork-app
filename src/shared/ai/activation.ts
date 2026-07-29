/**
 * КТО РАБОТАЕТ СЕЙЧАС — политика активации специалистов, правилами, а не случайностью.
 *
 * Задача ровно та, которую OASIS (camel-ai) называет нерешённой у себя: специалистов много,
 * работы мало, и нужен ПРИНЦИПИАЛЬНЫЙ ответ, кто работает на этом такте. Круговая очередь
 * (было) отвечает «по порядку» — то есть даёт работу тем, у кого её и так хватало.
 *
 * Правило владельца, которое здесь и живёт: **кому нечем подтвердить себя — тому работу
 * первым**. Это не вежливость: пока у пары «специалист × ремесло» нет ни одной попытки,
 * скоркарт честно говорит «нет оснований», и ранжировать некого. Отдав работу именно им, мы
 * получаем данные там, где их нет — вместо того чтобы копить десятый замер по тому, кто и так
 * измерен. То же самое делает бандит своим бонусом за неизвестность, только здесь это
 * детерминированное правило, которое видно глазами и проверяется тестом.
 *
 * Жизненный цикл берём из практики lifecycle-систем, где между «активен» и «спит» есть стадия
 * ПОД РИСКОМ с окном вмешательства: специалист не падает в сон молча — сначала он идёт первым
 * в очереди на работу. Сон здесь не могила: спящий возвращается, когда появляется работа его
 * ремесла и активные её не покрывают.
 */

/** Стадии. `archived` ставит человек — код сам никого не увольняет. */
export type Lifecycle = 'active' | 'idle' | 'dormant' | 'archived'

/** Сколько дней без работы делают специалиста «под риском». */
export const IDLE_AFTER_DAYS = 14
/** Сколько дней без работы усыпляют (после стадии под риском). */
export const DORMANT_AFTER_DAYS = 45

export interface Candidate {
  id: string
  /** Домены ремесла (без '*': универсалы в самогенерации не участвуют). */
  domains: string[]
  /** Текущая стадия из БД. */
  lifecycle: Lifecycle
  /** Сколько ПОПЫТОК за ним записано (обе оси скоркарта, суммарно). Ноль = нет оснований. */
  attempts: number
  /** Дней с последней работы; null — не работал никогда. */
  daysSinceWork: number | null
}

export interface WorkSlot {
  id: string
  /** Почему выбран именно он — уходит в журнал, чтобы решение читалось без догадок. */
  why: string
}

/** Стадия по бездействию. Возврат из сна решает не этот расчёт, а появление работы. */
export function stageFor(c: Pick<Candidate, 'lifecycle' | 'daysSinceWork'>): Lifecycle {
  if (c.lifecycle === 'archived') return 'archived' // из архива поднимает только человек
  const d = c.daysSinceWork
  if (d == null) return c.lifecycle === 'dormant' ? 'dormant' : 'idle' // не работал ни разу — под риском, а не активен
  if (d >= DORMANT_AFTER_DAYS) return 'dormant'
  if (d >= IDLE_AFTER_DAYS) return 'idle'
  return 'active'
}

/**
 * Очередь работы. Порядок — это и есть политика:
 *   1. НЕТ ОСНОВАНИЙ (ни одной попытки) — первыми: данных о них нет, и получить их можно
 *      только дав работу;
 *   2. дальше — по возрастанию числа попыток: у кого меньше подтверждений, тому нужнее;
 *   3. при равенстве — кто дольше не работал (включая тех, кто не работал никогда);
 *   4. при полном равенстве — по id, чтобы порядок был воспроизводимым, а не «как повезло».
 *
 * Архивные не участвуют. Спящие участвуют ТОЛЬКО когда работа их ремесла никем из
 * неспящих не покрыта — иначе сон был бы билетом в один конец.
 */
export function workQueue(candidates: Candidate[], domain?: string, priorityDomains: string[] = [], owners: string[] = []): WorkSlot[] {
  const fits = (c: Candidate) => !domain || c.domains.some((d) => d.toLowerCase() === domain.toLowerCase())
  const eligible = candidates.filter((c) => c.lifecycle !== 'archived' && fits(c))
  const awake = eligible.filter((c) => c.lifecycle !== 'dormant')
  // Спящих подключаем, только если бодрых по этому ремеслу нет вовсе.
  const pool = awake.length ? awake : eligible
  // ОДОБРЕННАЯ ПОВЕСТКА идёт ПЕРЕД всеми прочими правилами очереди: гендиректор сказал, что
  // растим эту тему, и «нет оснований» тут уже не аргумент — иначе одобрение ничего не меняет,
  // и повестка остаётся отчётом.
  // ХОЗЯИН одобренного пункта идёт первым — раньше всех прочих правил, включая тему: тема
  // говорит «что растим», хозяин — «кто за это отвечает», и делать должен именно он.
  const ownerSet = new Set(owners.filter(Boolean))
  const wanted = new Set(priorityDomains.map((d) => d.toLowerCase().trim()).filter(Boolean))
  const onAgenda = (c: Candidate) => (wanted.size ? c.domains.some((d) => wanted.has(d.toLowerCase())) : false)

  return [...pool]
    .sort((a, b) => {
      const ownerA = ownerSet.has(a.id), ownerB = ownerSet.has(b.id)
      if (ownerA !== ownerB) return ownerA ? -1 : 1
      if (onAgenda(a) !== onAgenda(b)) return onAgenda(a) ? -1 : 1
      if ((a.attempts === 0) !== (b.attempts === 0)) return a.attempts === 0 ? -1 : 1
      if (a.attempts !== b.attempts) return a.attempts - b.attempts
      const da = a.daysSinceWork ?? Number.POSITIVE_INFINITY
      const db = b.daysSinceWork ?? Number.POSITIVE_INFINITY
      if (da !== db) return db - da // дольше не работал → раньше в очереди
      return a.id.localeCompare(b.id)
    })
    .map((c) => {
      // Причина словами: по ней в журнале видно, ПОЧЕМУ работа досталась именно этому мастеру.
      const why = ownerSet.has(c.id) ? OWNER_REASON : onAgenda(c) ? AGENDA_REASON : reasonFor(c, pool === eligible && c.lifecycle === 'dormant')
      return { id: c.id, why }
    })
}

/** Причина «тема в одобренной повестке» — отдельной строкой: тернарник с двумя литералами
 *  правило i18n принимает за двуязычную строку, а это технический текст журнала. */
const AGENDA_REASON = 'в повестке развития — одобрено гендиректором'

/** Причина «он хозяин одобренного пункта» — по ней в журнале видно единственного ответственного. */
const OWNER_REASON = 'хозяин одобренного пункта повестки'

function reasonFor(c: Candidate, revived: boolean): string {
  if (revived) return 'разбужен: работа его ремесла, бодрых по этому домену нет'
  if (c.attempts === 0) return 'нет оснований — работа первым, чтобы они появились'
  if (c.daysSinceWork == null) return 'ни одной работы за ним'
  return `попыток ${c.attempts}, без работы ${c.daysSinceWork} дн.`
}

/** Пробуждение при выдаче работы: спящий, получивший задачу, снова активен. */
export function stageAfterWork(current: Lifecycle): Lifecycle {
  return current === 'archived' ? 'archived' : 'active'
}
