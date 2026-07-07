import 'server-only'
import { desc, eq, sql } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
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
export async function getModerationList(filter: ModFilter = 'all', limit = 200): Promise<ModItem[]> {
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
  const rows =
    filter === 'all'
      ? await base.orderBy(desc(templates.createdAt)).limit(limit)
      : await base.where(eq(templates.moderation, filter)).orderBy(...prio).limit(limit)
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
