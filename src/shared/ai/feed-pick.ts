import 'server-only'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, feedItems } from '@/shared/db'

/**
 * ВЫБОР МАТЕРИАЛА ИЗ ПОТОКА — читающая половина ленты.
 *
 * Почему в shared, а не рядом с петлёй сбора (`features/feeds`): материал нужен производству
 * (`features/library/selfgen`), а фича из фичи у нас не импортируется — границы слоёв это
 * запрещают, и обход вскрыл бы базовую линию подавлений целиком. Сбор остаётся в фиче,
 * выбор — здесь: пишет одна сторона, читают многие.
 */

/** Один элемент потока в том виде, в котором его видит специалист. */
export interface FeedPick {
  id: string
  title: string
  url: string
  hint: string
  publishedAt: Date | null
  tags: string[]
}

/**
 * Свежий НЕиспользованный материал по темам специалиста.
 *
 * Универсал (`*`) материала не получает: лента должна расти вглубь темы, а «любая новость»
 * даст ленту ни о чём. Порядок — сначала новое по дате публикации; без даты (источник её не
 * отдал) — по времени попадания к нам.
 */
export async function freshForDomains(domains: string[], limit = 20): Promise<FeedPick[]> {
  const tags = domains.filter((d) => d && d !== '*')
  if (!tags.length) return []
  const rows = await db
    .select({
      id: feedItems.id,
      title: feedItems.title,
      url: feedItems.url,
      hint: feedItems.hint,
      publishedAt: feedItems.publishedAt,
      tags: feedItems.tags,
    })
    .from(feedItems)
    // && (пересечение массивов) через sql.param: массив в шаблоне без параметра
    // разворачивается в record, и Postgres падает на «text[] && record».
    .where(and(isNull(feedItems.usedAt), sql`${feedItems.tags} && ${sql.param(tags)}::text[]`))
    .orderBy(desc(feedItems.publishedAt), desc(feedItems.createdAt))
    .limit(limit)
  return rows
}

/**
 * Когда в списке появлялся самый свежий материал из потока — время, по которому судится
 * свежесть ленты (планка живого списка, см. shared/ai/readiness).
 *
 * Берём дату ПУБЛИКАЦИИ материала, а не время попадания к нам: лента, набитая вчера
 * прошлогодними статьями, свежей не является. Даты нет — тогда время попадания, другого
 * ответа у нас всё равно нет. `null` = материала из потока в списке не было вовсе; решать,
 * что это значит, вызывающему (для планки это «свежесть неизвестна», то есть блокер).
 */
export async function freshestUsedAt(templateId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(coalesce(${feedItems.publishedAt}, ${feedItems.createdAt}))` })
    .from(feedItems)
    .where(eq(feedItems.usedTemplateId, templateId))
  return row?.at ? new Date(row.at) : null
}

/**
 * Отметить материал использованным.
 *
 * Отмечаем в ЛЮБОМ исходе, если элемент уже уехал в модель: иначе неудачный материал застрянет
 * в голове очереди и петля будет жевать его каждый проход, не двигаясь дальше. `templateId`
 * пустой, когда список так и не появился — по этой паре потом видно, что из потока выросло.
 */
export async function markUsed(ids: string[], templateId: string | null): Promise<void> {
  if (!ids.length) return
  await db.update(feedItems).set({ usedAt: new Date(), usedTemplateId: templateId }).where(inArray(feedItems.id, ids))
}
