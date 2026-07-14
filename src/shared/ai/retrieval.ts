import 'server-only'
import { and, cosineDistance, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db, embeddings, templates } from '@/shared/db'
import { getAiSettings } from '@/shared/settings/ai'
import { embedOne } from './embeddings'
import type { Lang, LocaleText } from '@/shared/i18n'

/** Достать текст LocaleText на языке зрителя (фолбэк en → первый непустой). */
function pickText(t: LocaleText | null | undefined, lang: Lang): string {
  if (!t) return ''
  const rec = t as unknown as Record<string, string | undefined>
  return (rec[lang] || rec.en || Object.values(rec).find(Boolean) || '').trim()
}

export interface Precedent {
  title: string
  desc: string
  tags: string[]
}

/**
 * «Старейшина ищет по нашим спискам»: похожие СУЩЕСТВУЮЩИЕ публичные списки корпуса SetFork
 * через pgvector-cosine (та же инфра, что семантический поиск ленты). Пусто, если запрос нельзя
 * векторизовать или в корпусе нет эмбеддингов. Embedding-вызов пишется в ai_usage (feature 'embed').
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
      ),
    )
    .orderBy(desc(sql<number>`1 - (${distance})`))
    .limit(opts.limit ?? 3)
  return rows
    .map((r) => ({ title: pickText(r.title as LocaleText, lang), desc: pickText(r.desc as LocaleText, lang), tags: (r.tags as string[]) ?? [] }))
    .filter((p) => p.title)
}
