import 'server-only'
import { and, cosineDistance, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db, embeddings, templates } from '@/shared/db'
import { embedOne } from './embeddings'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import { rrf } from './rrf'

// #8: порог косинус-схожести. Прецеденты слабее — мусор (нерелевантные списки нельзя подмешивать
// в промпт эксперта, иначе кулинарный запрос тянет DevOps-списки). similarity = 1 - distance.
const MIN_SIMILARITY = 0.3
// Шагов с одного списка в выдаче — не больше двух: один длинный список не должен
// вытеснять разнообразие источников.
const MAX_STEPS_PER_LIST = 2

export interface Precedent {
  title: string
  desc: string
  tags: string[]
}

/** Шаг-прецедент (kind='step', KAG-lite шаг 1): content уже несёт заголовок списка + секцию + шаг. */
export interface StepPrecedent {
  content: string
  tags: string[]
}

/**
 * «Старейшина ищет по нашим спискам»: похожие СУЩЕСТВУЮЩИЕ публичные списки корпуса SetFork
 * через pgvector-cosine (та же инфра, что семантический поиск ленты) — и с #index-chunks ещё и
 * ОТДЕЛЬНЫЕ ШАГИ похожих списков (kind='step'). Один embed-вызов, две выборки по одному вектору.
 * Пусто, если запрос нельзя векторизовать или в корпусе нет эмбеддингов.
 *
 * #7: запрос + visibility-фильтр СОЗНАТЕЛЬНО дублируют semanticFeed (features/library/queries.ts) —
 * FSD-граница запрещает shared/ai импортить features/*. Держать published/public/moderation='active'
 * В СИНХРОНЕ с visibleFilter() там (при смене правил видимости/модерации — править оба места).
 */
/**
 * Мир знаний, из которого копаем (вторая ручка кирки: глубина × МИР).
 *   'public'   — общая шахта: только публичные опубликованные активные списки;
 *   'personal' — общая ПЛЮС личные списки самого зрителя.
 * Чужое приватное недостижимо ни при каком значении.
 */
export type PrecedentScope = 'public' | 'personal'

export async function findPrecedents(
  query: string,
  lang: Lang,
  opts: { userId?: string | null; limit?: number; stepLimit?: number; scope?: PrecedentScope } = {},
): Promise<{ lists: Precedent[]; steps: StepPrecedent[] }> {
  // Вектор может отсутствовать (эмбеддинги выключены/сбой) — с гибридом это больше
  // НЕ приговор: лексическая ветка работает без него.
  const vec = await embedOne(query, 'query', { userId: opts.userId ?? null, refType: 'council-seek' })
  const distance = vec ? cosineDistance(embeddings.embedding, vec) : sql`1`
  // МИР ЗНАНИЙ (вторая ручка кирки): 'public' — общая шахта; 'personal' — общая ПЛЮС
  // личные списки самого пользователя. Раньше userId шёл только в учёт embed-вызова, а
  // выборка всегда была public-only — то есть личный мир не существовал вовсе.
  //
  // ЧЕКПОИНТ ПРИВАТНОСТИ: расширение допускается ТОЛЬКО на списки самого зрителя
  // (owner_id = его id). Чужое приватное не подмешивается ни при каком scope — публичное
  // втекает в личную работу, личное наружу не вытекает (рамка NDA).
  const scope = opts.scope ?? 'public'
  const viewer = opts.userId ?? null
  const mine = scope === 'personal' && viewer ? sql`or ${templates.ownerId} = ${viewer}` : sql``
  const reachable = sql`((${templates.status} = 'published' and ${templates.visibility} = 'public' and ${templates.moderation} = 'active') ${mine})`
  const visible = and(
    isNotNull(embeddings.embedding),
    reachable,
    sql`${distance} <= ${1 - MIN_SIMILARITY}`, // #8: только реально похожие (similarity >= порога)
  )
  const stepLimit = opts.stepLimit ?? 5
  // Вес практики (HQ §5 шаг 3): звёзды и форки МЯГКО поднимают прецедент — проверенное
  // сообществом предпочитается при близкой семантике, но никогда не перебивает смысл
  // (логарифм + малый коэффициент: 10 звёзд ≈ +19% к скору, 100 ≈ +37%).
  const score = sql<number>`(1 - (${distance})) * (1 + 0.08 * ln(1 + ${templates.starsCount} + ${templates.forksCount}))`
  // ГИБРИД (P1 анализа поиска, HQ research/2026-07-22): к вектору — лексическая ветка
  // (FTS 'simple', без стемминга: контент EN/RU). На малом корпусе семантика промахивается
  // по точным терминам («pgvector», «маршмеллоу»); слияние — Reciprocal Rank Fusion.
  const listLimit = opts.limit ?? 3
  // Лексическая ветка обязана видеть РОВНО тот же мир, что векторная: иначе один и тот
  // же список то попадал бы в прецеденты, то нет — в зависимости от того, какая ветка
  // сработала. Поэтому один и тот же предикат, а не две копии правил.
  const pubVisible = reachable
  const listText = sql`(coalesce(${templates.title}->>'en','') || ' ' || coalesce(${templates.title}->>'ru','') || ' ' || coalesce(${templates.desc}->>'en','') || ' ' || coalesce(${templates.desc}->>'ru',''))`
  const FETCH_N = 10 // с запасом под RRF-слияние и срез «≤2 шагов со списка»
  const [vecLists, lexLists, vecSteps, lexSteps] = await Promise.all([
    vec
      ? db
          .select({ id: templates.id, title: templates.title, desc: templates.desc, tags: templates.tags })
          .from(embeddings)
          .innerJoin(templates, eq(embeddings.refId, templates.id))
          .where(and(eq(embeddings.kind, 'list'), visible))
          .orderBy(desc(score))
          .limit(FETCH_N)
      : Promise.resolve([]),
    db
      .select({ id: templates.id, title: templates.title, desc: templates.desc, tags: templates.tags })
      .from(templates)
      .where(and(pubVisible, sql`to_tsvector('simple', ${listText}) @@ websearch_to_tsquery('simple', ${query})`))
      .orderBy(desc(sql`ts_rank_cd(to_tsvector('simple', ${listText}), websearch_to_tsquery('simple', ${query}))`))
      .limit(FETCH_N),
    vec && stepLimit > 0
      ? db
          .select({ id: embeddings.id, refId: embeddings.refId, content: embeddings.content, tags: templates.tags })
          .from(embeddings)
          .innerJoin(templates, eq(embeddings.refId, templates.id))
          .where(and(eq(embeddings.kind, 'step'), visible))
          .orderBy(desc(score))
          .limit(FETCH_N)
      : Promise.resolve([]),
    stepLimit > 0
      ? db
          .select({ id: embeddings.id, refId: embeddings.refId, content: embeddings.content, tags: templates.tags })
          .from(embeddings)
          .innerJoin(templates, eq(embeddings.refId, templates.id))
          .where(and(eq(embeddings.kind, 'step'), pubVisible, sql`to_tsvector('simple', ${embeddings.content}) @@ websearch_to_tsquery('simple', ${query})`))
          .orderBy(desc(sql`ts_rank_cd(to_tsvector('simple', ${embeddings.content}), websearch_to_tsquery('simple', ${query}))`))
          .limit(FETCH_N)
      : Promise.resolve([]),
  ])

  const lists = rrf(vecLists, lexLists, (r) => r.id)
    .slice(0, listLimit)
    .map((r) => ({ title: tr(r.title as LocaleText, lang), desc: tr(r.desc as LocaleText, lang), tags: (r.tags as string[]) ?? [] }))
    .filter((p) => p.title)

  const perList = new Map<string, number>()
  const steps: StepPrecedent[] = []
  for (const r of rrf(vecSteps, lexSteps, (x) => x.id)) {
    const key = r.refId ?? ''
    const n = perList.get(key) ?? 0
    if (n >= MAX_STEPS_PER_LIST) continue
    perList.set(key, n + 1)
    steps.push({ content: r.content, tags: (r.tags as string[]) ?? [] })
    if (steps.length >= stepLimit) break
  }
  return { lists, steps }
}
