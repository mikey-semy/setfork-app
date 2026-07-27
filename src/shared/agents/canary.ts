import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { agentActions, db, templates } from '@/shared/db'
import { tripCircuit } from './policy'
import { log } from '@/shared/observability'

/**
 * КАНАРЕЙКА — предохранители, которые обязаны существовать ДО того, как петля начнёт
 * публиковать без человека.
 *
 * Предохранитель (`tripCircuit`) был написан в фундаменте автономии, но его никто не срывал:
 * механизм без триггера — это иллюзия защиты. Здесь триггеры.
 *
 * Три сигнала, каждый отвечает на свой вопрос:
 *
 *   1. КВОТА публикаций в сутки. Отвечает на «а что если планка настроена слишком мягко» —
 *      ошибка настройки не должна за ночь залить каталог. Квота не срывает предохранитель:
 *      это нормальный режим работы, просто дальше ждём человека.
 *   2. СЕРИЯ ОШИБОК. Отвечает на «петля сломалась и молотит впустую». Срывает предохранитель:
 *      дальше крутиться бессмысленно и не бесплатно.
 *   3. ОПУБЛИКОВАЛИ → МОДЕРАЦИЯ СНЯЛА. Самый сильный сигнал: автономия выпустила то, что
 *      система сама признала небезопасным. Срывает предохранитель немедленно.
 *
 * Снимает предохранитель ТОЛЬКО человек (см. policy.resetCircuit) — молча
 * самовосстанавливаться такие сигналы не должны.
 */

/** Сколько ошибок подряд считаем поломкой петли, а не неудачным днём. */
export const ERROR_STREAK_TRIP = 5

/** Сколько списков петля вправе опубликовать без человека за сутки (дефолт планки). */
export const DEFAULT_PUBLISH_PER_DAY = 3

/** Осталось ли право публиковать: сколько уже опубликовано автономно за серверные сутки. */
export async function publishQuotaLeft(loop: string, perDay = DEFAULT_PUBLISH_PER_DAY): Promise<number> {
  if (perDay <= 0) return 0
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.loop, loop),
        eq(agentActions.action, 'list.publish'),
        eq(agentActions.resultStatus, 'ok'),
        sql`${agentActions.occurredAt} >= date_trunc('day', now())`,
      ),
    )
  return Math.max(0, perDay - (row?.n ?? 0))
}

/**
 * Проверка здоровья петли перед проходом. true — можно работать, false — предохранитель
 * сорван (и причина записана). Вызывать в начале прохода: дешёвые SELECT, без модели.
 */
export async function autonomyHealthy(loop: string): Promise<boolean> {
  // 1. Серия ошибок подряд. Считаем по последним записям: «подряд» важнее, чем «всего»,
  // иначе одна давняя серия навсегда держала бы петлю на грани.
  const recent = await db
    .select({ status: agentActions.resultStatus })
    .from(agentActions)
    .where(eq(agentActions.loop, loop))
    .orderBy(desc(agentActions.occurredAt))
    .limit(ERROR_STREAK_TRIP)
  if (recent.length === ERROR_STREAK_TRIP && recent.every((r) => r.status === 'error')) {
    await tripCircuit(loop, `${ERROR_STREAK_TRIP} ошибок подряд — петля молотит впустую`)
    return false
  }

  // 2. Автономно опубликованное, которое модерация сняла. Ищем по id списка из журнала:
  // именно поэтому в сигнал публикации пишется templateId, а не только слаг.
  const flagged = await db
    .select({ slug: templates.slug, moderation: templates.moderation })
    .from(agentActions)
    .innerJoin(templates, sql`${templates.id}::text = ${agentActions.signal}->>'templateId'`)
    .where(
      and(
        eq(agentActions.loop, loop),
        eq(agentActions.action, 'list.publish'),
        eq(agentActions.resultStatus, 'ok'),
        sql`${templates.moderation} in ('flagged', 'hidden')`,
      ),
    )
    .limit(1)
  if (flagged.length) {
    await tripCircuit(loop, `автономно опубликованный список снят модерацией: ${flagged[0].slug}`)
    return false
  }
  return true
}

/** Для отчёта: сколько автономных публикаций сегодня и остаток квоты. */
export async function publishedToday(loop: string, perDay = DEFAULT_PUBLISH_PER_DAY): Promise<{ used: number; left: number }> {
  const left = await publishQuotaLeft(loop, perDay)
  return { used: Math.max(0, perDay - left), left }
}

/** Сорвать предохранитель вручную из кода петли (например при неожиданном состоянии). */
export async function tripWithReason(loop: string, reason: string): Promise<void> {
  log.warn?.('canary trip', { loop, reason })
  await tripCircuit(loop, reason)
}
