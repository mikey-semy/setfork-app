import 'server-only'
import { cache } from 'react'
import { desc, inArray, sql } from 'drizzle-orm'
import { db, tags } from '@/shared/db'
import { likeContains } from '@/shared/db/like'

// Реестр тегов (чтение). templates.tags хранит slug'и; здесь — метаданные тега.
// Курирование/переименование/слияние/удаление — в ./actions (админ).

export interface TagRow {
  slug: string
  label: string | null
  description: string | null
  curated: boolean
  usageCount: number
}

const toRow = (r: typeof tags.$inferSelect): TagRow => ({
  slug: r.slug,
  label: r.label,
  description: r.description,
  curated: r.curated,
  usageCount: r.usageCount,
})

/** Автокомплит инпута тегов: сначала курируемые, затем по популярности.
 *  Пустой запрос → топ реестра (подсказки «из чего выбрать»). */
export async function searchTags(q: string, limit = 8): Promise<TagRow[]> {
  const term = q.trim().toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')
  const rows = await db
    .select()
    .from(tags)
    .where(term ? sql`${tags.slug} like ${term + '%'}` : sql`true`)
    .orderBy(desc(tags.curated), desc(tags.usageCount), tags.slug)
    .limit(Math.min(limit, 20))
  return rows.map(toRow)
}

/** Весь реестр (индекс /tags и админка): фильтр по подстроке, курируемые/популярные выше. */
export async function listTags(opts: { q?: string; curatedOnly?: boolean; limit?: number } = {}): Promise<TagRow[]> {
  const term = (opts.q ?? '').trim().toLowerCase()
  const rows = await db
    .select()
    .from(tags)
    .where(
      sql`${opts.curatedOnly ? sql`${tags.curated} = true and ` : sql``}(${term ? sql`${tags.slug} like ${likeContains(term)}` : sql`true`})`,
    )
    .orderBy(desc(tags.curated), desc(tags.usageCount), tags.slug)
    .limit(opts.limit ?? 500)
  return rows.map(toRow)
}

/** Один тег по slug (для страницы /tags/[slug]). cache() — дедуп generateMetadata+страница. */
export const getTag = cache(async (slug: string): Promise<TagRow | null> => {
  const [r] = await db.select().from(tags).where(sql`${tags.slug} = ${slug}`).limit(1)
  return r ? toRow(r) : null
})

/** Известен ли slug в реестре (для валидации «только курируемые»). */
export async function knownTagSlugs(slugs: string[]): Promise<Set<string>> {
  if (!slugs.length) return new Set()
  const rows = await db.select({ slug: tags.slug }).from(tags).where(inArray(tags.slug, slugs))
  return new Set(rows.map((r) => r.slug))
}
