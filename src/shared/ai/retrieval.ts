import 'server-only'
import { and, cosineDistance, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db, embeddings, templates } from '@/shared/db'
import { getAiSettings } from '@/shared/settings/ai'
import { embedOne } from './embeddings'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'

// #8: порог косинус-схожести. Прецеденты слабее — мусор (нерелевантные списки нельзя подмешивать
// в промпт эксперта, иначе кулинарный запрос тянет DevOps-списки). similarity = 1 - distance.
const MIN_SIMILARITY = 0.3

export interface Precedent {
  title: string
  desc: string
  tags: string[]
}

/**
 * «Старейшина ищет по нашим спискам»: похожие СУЩЕСТВУЮЩИЕ публичные списки корпуса SetFork
 * через pgvector-cosine (та же инфра, что семантический поиск ленты). Пусто, если запрос нельзя
 * векторизовать или в корпусе нет эмбеддингов. Embedding-вызов пишется в ai_usage (feature 'embed').
 *
 * #7: запрос + visibility-фильтр СОЗНАТЕЛЬНО дублируют semanticFeed (features/library/queries.ts) —
 * FSD-граница запрещает shared/ai импортить features/*. Держать published/public/moderation='active'
 * В СИНХРОНЕ с visibleFilter() там (при смене правил видимости/модерации — править оба места).
 */
export async function findPrecedents(query: string, lang: Lang, opts: { userId?: string | null; limit?: number } = {}): Promise<Precedent[]> {
  const { embeddingModel } = await getAiSettings()
  const vec = await embedOne(query, embeddingModel, { userId: opts.userId ?? null, refType: 'council-seek' })
  if (!vec) return []
  const distance = cosineDistance(embeddings.embedding, vec)
  const rows = await db
    .select({ title: templates.title, desc: templates.desc, tags: templates.tags })
    .from(embeddings)
    .innerJoin(templates, eq(embeddings.refId, templates.id))
    .where(
      and(
        eq(embeddings.kind, 'list'),
        isNotNull(embeddings.embedding),
        eq(templates.status, 'published'),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        sql`${distance} <= ${1 - MIN_SIMILARITY}`, // #8: только реально похожие (similarity >= порога)
      ),
    )
    .orderBy(desc(sql<number>`1 - (${distance})`))
    .limit(opts.limit ?? 3)
  return rows
    .map((r) => ({ title: tr(r.title as LocaleText, lang), desc: tr(r.desc as LocaleText, lang), tags: (r.tags as string[]) ?? [] }))
    .filter((p) => p.title)
}
