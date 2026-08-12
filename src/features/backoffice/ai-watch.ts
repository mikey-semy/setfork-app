import 'server-only'
import { and, desc, gte, ne, sql } from 'drizzle-orm'
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
}

/**
 * Хвост журнала вызовов: подряд идущие неудачи с конца.
 *
 * Эмбеддинги исключены намеренно — они ходят другим маршрутом (у OpenRouter это отдельный
 * эндпоинт) и в инциденте 12.08 проходили, пока чат-вызовы падали. Считать их вместе
 * значило бы прятать поломку за успехами соседнего канала.
 */
export async function channelState(): Promise<ChannelState> {
  const rows = await db
    .select({ outcome: aiUsage.outcome, model: aiUsage.model })
    .from(aiUsage)
    .where(ne(aiUsage.feature, 'embed'))
    .orderBy(desc(aiUsage.createdAt))
    .limit(ERROR_STREAK_TRIP)
  const outcomes: string[] = []
  for (const r of rows) {
    if (r.outcome === 'ok') break
    outcomes.push(r.outcome)
  }
  return { failStreak: outcomes.length, lastModel: rows[0]?.model ?? '', outcomes }
}

/** Канал считается лежащим: серия отказов достигла общей планки. */
export const channelDown = (s: ChannelState): boolean => s.failStreak >= ERROR_STREAK_TRIP

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
