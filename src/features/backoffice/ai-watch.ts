import 'server-only'
import { and, desc, eq, gt, gte, ne, sql } from 'drizzle-orm'
import { aiUsage, db } from '@/shared/db'
import { ERROR_STREAK_TRIP } from '@/shared/agents/canary'

/**
 * СТОРОЖ КАНАЛА К МОДЕЛИ — та часть работы аналитика моделей, которую нельзя делать
 * страницей.
 *
 * Повод — два инцидента подряд, и оба обнаружились случайно. 29–31.07: провайдер
 * переключили на снятую модель, все вызовы падали двое суток, ни одного сигнала.
 * 05–12.08: контейнер канона поднялся со списанным egress-мостом в /etc/hosts, неделю
 * подряд `error`, компания не сделала ничего — и снова ни одного сигнала. Оба раза
 * поломка была видна в `ai_usage` с первой минуты, но смотреть туда некому.
 *
 * Считается КОДОМ по журналу вызовов: ни одного обращения к модели (сторож, который сам
 * зовёт модель, замолкает ровно тогда, когда нужен). Порог — тот же `ERROR_STREAK_TRIP`,
 * что у предохранителя петель: одна величина «серия отказов» на весь проект.
 */

/** Что именно видно в журнале вызовов на данный момент. */
export interface ChannelState {
  /** Сколько последних вызовов подряд закончились неудачей (ok обрывает счёт). */
  failStreak: number
  /** Модель последнего вызова — по ней видно, куда именно перестало ходить. */
  lastModel: string
  /** Исходы серии: error/timeout/invalid различают «не пустили» и «не дождались». */
  outcomes: string[]
  /**
   * ИМЯ ЭПИЗОДА — время последнего успешного вызова (никогда не было успеха → 'none').
   *
   * Именно оно, а не начало видимой серии: хвост читается фиксированной длины, и при
   * длящемся обрыве каждый новый отказ сдвигал бы «начало серии» вперёд. Сторож счёл бы
   * это новым обрывом и слал письмо каждый час — ровно та беда, от которой защищаемся.
   * Момент последнего успеха стоит на месте, пока канал не оживёт: все отказы после него
   * и есть один эпизод. Ожил и снова лёг — имя другое, значит и письмо новое.
   */
  episode: string
}

/**
 * Окно свежести хвоста. Без него серия отказов «застывает»: упали последние пять вызовов,
 * трафик прекратился — и сторож считал бы канал лежащим бесконечно, хотя проверить это
 * стало нечем. Сутки выбраны по ритму петель: у самой редкой из платных (садовник) проход
 * раз в двое суток, но за сутки его успевают разбудить и ручные действия.
 */
const FRESH_WINDOW_MS = 24 * 3_600_000

/**
 * Хвост журнала вызовов: подряд идущие неудачи с конца, в пределах свежего окна.
 *
 * Эмбеддинги исключены намеренно — они ходят другим маршрутом (у OpenRouter это отдельный
 * эндпоинт) и в инциденте 12.08 проходили, пока чат-вызовы падали. Считать их вместе
 * значило бы прятать поломку за успехами соседнего канала.
 */
/** Служебная отметка учёта, а не вызов модели: нулевые токены, записывается ПОСЛЕ работы
 *  (например, `council-run` — расход слота лимита). Считать её успехом канала нельзя: модель
 *  за ней не звалась, а «канал ожил» по такой строке — обещание, которого никто не давал
 *  (находка авто-ревью по #775). */
// ⚠️ `is distinct from`, а не `<>`: у обычного вызова `ref_type` пуст, а сравнение с NULL
// даёт NULL — то есть строка молча выпадает из отбора, и хвост отказов оказывается пустым.
// Ровно так первая версия этой правки погасила сторожа целиком.
const notAccounting = sql`${aiUsage.refType} is distinct from 'council-run'`

export async function channelState(): Promise<ChannelState> {
  // ОБА чтения — из ОДНОГО снимка. Порознь они видят разное: успех, записанный между ними,
  // попадал во второй запрос и не попадал в первый, и состояние выходило противоречивым —
  // «канал лежит», но эпизод назван именем этого самого успеха. Тревога уходила про уже
  // законченный обрыв, а «восстановлен» потом не приходил вовсе: эпизод закрыт заранее
  // (находка авто-ревью по #775). Repeatable read даёт обоим запросам одну картину мира.
  return db.transaction(
    async (tx) => {
      const [rows, success] = await Promise.all([
        tx
          .select({ outcome: aiUsage.outcome, model: aiUsage.model })
          .from(aiUsage)
          .where(and(ne(aiUsage.feature, 'embed'), notAccounting, gte(aiUsage.createdAt, new Date(Date.now() - FRESH_WINDOW_MS))))
          .orderBy(desc(aiUsage.createdAt))
          .limit(ERROR_STREAK_TRIP),
        // Последний успех берём БЕЗ окна свежести: имя эпизода должно быть устойчивым, даже
        // когда сам успех состарился и из хвоста уехал.
        tx
          .select({ at: aiUsage.createdAt })
          .from(aiUsage)
          .where(and(ne(aiUsage.feature, 'embed'), notAccounting, eq(aiUsage.outcome, 'ok')))
          .orderBy(desc(aiUsage.createdAt))
          .limit(1),
      ])
      const outcomes: string[] = []
      for (const r of rows) {
        if (r.outcome === 'ok') break
        outcomes.push(r.outcome)
      }
      return {
        failStreak: outcomes.length,
        lastModel: rows[0]?.model ?? '',
        outcomes,
        episode: success[0]?.at?.toISOString() ?? NO_SUCCESS_YET,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

/** Успешных вызовов не было вовсе — тоже устойчивое имя эпизода (свежий стенд). */
const NO_SUCCESS_YET = 'none'

/** Канал считается лежащим: серия отказов достигла общей планки. */
export const channelDown = (s: ChannelState): boolean => s.failStreak >= ERROR_STREAK_TRIP

/**
 * Был ли УСПЕШНЫЙ вызов после указанного момента.
 *
 * Единственное честное доказательство, что канал вернулся. Пустой хвост доказательством
 * не является: отказы могли просто состариться и выпасть из окна свежести, а вызовов с
 * тех пор не было вовсе — «работает» в таком случае мы бы выдумали.
 */
export async function successAfter(since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(and(ne(aiUsage.feature, 'embed'), eq(aiUsage.outcome, 'ok'), gt(aiUsage.createdAt, since)))
    .limit(1)
  return !!row
}

/** Сколько вызовов было за последние сутки — цифра для письма сторожа: отличает
 *  «канал сломан» от «сегодня никто не звал». Окно скользящее, как и сама проверка. */
export async function callsLastDay(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, new Date(Date.now() - 86_400_000)), ne(aiUsage.feature, 'embed')))
  return row?.n ?? 0
}

/**
 * Вызовы за КАЛЕНДАРНЫЙ день — сырьё для сводки летописца.
 *
 * Границы те же, что у «Дня компании» (`date_trunc('day', now())` со сдвигом): проход
 * летописца встаёт раз в сутки от старта процесса, поэтому скользящее окно относило бы
 * сегодняшние вызовы во вчерашний отчёт и наоборот.
 */
export async function callsOnDay(daysAgo: number): Promise<{ calls: number; failed: number }> {
  const [row] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      failed: sql<number>`(count(*) filter (where ${aiUsage.outcome} <> 'ok'))::int`,
    })
    .from(aiUsage)
    .where(
      and(
        ne(aiUsage.feature, 'embed'),
        notAccounting,
        // ТОЛЬКО ВЫЗОВЫ КОМПАНИИ: сводка говорит про её день, и чужие отказы ей приписывать
        // нельзя. Раньше признака не было, и пять неудачных генераций ЧЕЛОВЕКА читались как
        // «компания не сделала ничего» (находка авто-ревью #775). Признак ставит контекст
        // исполнения петли — см. shared/ai/actor-context.
        eq(aiUsage.actor, 'company'),
        sql`${aiUsage.createdAt} >= date_trunc('day', now()) - (${daysAgo}::int * interval '1 day')`,
        sql`${aiUsage.createdAt} < date_trunc('day', now()) - ((${daysAgo}::int - 1) * interval '1 day')`,
      ),
    )
  return { calls: row?.calls ?? 0, failed: row?.failed ?? 0 }
}

/**
 * Канал лежал ВЕСЬ день: вызовов было не меньше планки серии и ни один не прошёл.
 *
 * Именно это, а не «вызовы были», даёт летописцу право говорить о поломке. Отделить
 * работу компании от пользовательской по журналу нельзя (`gnome_id` не проставляется, у
 * трети фоновых `refine` пуст и `user_id`), поэтому судим по КАРТИНЕ дня: одна упавшая
 * генерация человека среди успешных — это не поломка компании, а сплошной отказ при
 * живом трафике поломкой быть перестаёт только вместе с каналом.
 */
export function channelBrokenAllDay(day: { calls: number; failed: number }): boolean {
  return day.calls >= ERROR_STREAK_TRIP && day.failed === day.calls
}
