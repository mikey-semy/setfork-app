import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { likeContains } from '@/shared/db/like'
import type { LocaleText } from '@/shared/i18n'

export type ModFilter = 'all' | 'pending' | 'flagged' | 'hidden' | 'sample'

export interface ModItem {
  id: string
  ownerHandle: string
  slug: string
  title: LocaleText
  visibility: 'public' | 'private'
  moderation: 'active' | 'pending' | 'flagged' | 'hidden'
  moderationReason: string | null
  moderationSeverity: number
  appealedAt: Date | null
  verified: boolean
  starsCount: number
  createdAt: Date
}

/** Список публикаций для модерации (админ видит всё). */
export async function getModerationList(filter: ModFilter = 'all', limit = 200, q = ''): Promise<ModItem[]> {
  const base = db
    .select({
      id: templates.id,
      ownerHandle: users.handle,
      slug: templates.slug,
      title: templates.title,
      visibility: templates.visibility,
      moderation: templates.moderation,
      moderationReason: templates.moderationReason,
      moderationSeverity: templates.moderationSeverity,
      appealedAt: templates.appealedAt,
      verified: templates.verified,
      starsCount: templates.starsCount,
      createdAt: templates.createdAt,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))

  // Выборочный контроль автомата (spot-check): случайные живые списки —
  // ловим ложные одобрения, меряем качество авто-проверки.
  if (filter === 'sample') {
    const rows = await base
      .where(sql`${templates.moderation} = 'active' and ${templates.visibility} = 'public' and ${templates.status} = 'published'`)
      .orderBy(sql`random()`)
      .limit(10)
    return rows as ModItem[]
  }
  // Очередь: апелляции наверх, затем тяжесть (S1/S3/S4/S9, спам, «ИИ не уверен»), затем охват.
  const prio = [
    sql`${templates.appealedAt} is null`,
    desc(templates.moderationSeverity),
    desc(templates.starsCount),
    desc(templates.createdAt),
  ]
  // Поиск по адресу и названию. Очередь отдаёт до 200 строк, и без него найти
  // конкретный список в ней можно было только глазами, прокруткой.
  //
  // Ищем и по НИКУ АВТОРА тоже: в модерации разбирают не только «этот список», но и
  // «всё, что принёс вот этот автор», — а это самый частый вопрос при разборе спама.
  // `likeContains`, а не шаблон руками: `%` и `_` — подстановочные знаки, и `?q=%`
  // вернул бы ВСЮ очередь, а `?q=_b` находил бы «ab». Сторож этого правила поймал меня
  // здесь на первом же прогоне — ровно то, ради чего он и заведён.
  const like = q.trim() ? likeContains(q) : null
  const search = like
    ? sql`(${templates.slug} ilike ${like} or ${users.handle} ilike ${like} or ${templates.title}::text ilike ${like})`
    : undefined

  const where =
    filter === 'all' ? search : search ? and(eq(templates.moderation, filter), search) : eq(templates.moderation, filter)

  const rows = where
    ? await base.where(where).orderBy(...(filter === 'all' ? [desc(templates.createdAt)] : prio)).limit(limit)
    : await base.orderBy(desc(templates.createdAt)).limit(limit)
  return rows as ModItem[]
}

export async function getModerationCounts(): Promise<{ pending: number; flagged: number; hidden: number }> {
  const [r] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${templates.moderation} = 'pending')::int`,
      flagged: sql<number>`count(*) filter (where ${templates.moderation} = 'flagged')::int`,
      hidden: sql<number>`count(*) filter (where ${templates.moderation} = 'hidden')::int`,
    })
    .from(templates)
  return { pending: r?.pending ?? 0, flagged: r?.flagged ?? 0, hidden: r?.hidden ?? 0 }
}
