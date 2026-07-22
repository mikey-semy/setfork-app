import 'server-only'
import { sql } from 'drizzle-orm'
import { generateText } from 'ai'
import { db, knowledgeTriples } from '@/shared/db'
import { getAiSettings } from '@/shared/settings/ai'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { spotlight } from './spotlight'
import { extractUsage, outcomeOf, recordUsage } from './usage'

/**
 * Тройки знаний (HQ §5, старт полного KAG): извлечение и выборка «ремесленных
 * правил» — переносимых связей, которые одна выученная запись улучшает сотню
 * будущих списков.
 */

/** Словарь отношений — старт онтологии (§5.2). Не enum в БД: словарь растёт кодом. */
export const RELATIONS = ['replaces', 'requires', 'precedes', 'excludes', 'part-of', 'warns'] as const
export type Relation = (typeof RELATIONS)[number]

export interface Triple {
  subject: string
  relation: Relation
  object: string
  domain: string
}

const firstArr = (t: string) => {
  const s = t.indexOf('[')
  const e = t.lastIndexOf(']')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}

/** Извлечь тройки из текста списка. Пустой массив — валидный исход (не всё содержит правила). */
export async function extractTriples(listText: string, meta: { templateId: string }): Promise<Triple[]> {
  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return []
  const model = await pickChatModel(settings)
  const sp = spotlight()
  const system = `You mine CRAFT KNOWLEDGE from a how-to list: transferable subject→relation→object facts that stay true OUTSIDE this list.
Allowed relations ONLY: ${RELATIONS.join(', ')} ("warns" = subject is a known pitfall/danger of object).
Rules: subject/object are short noun phrases (1-4 words, lowercase, keep the list's language); domain = one lowercase topic tag; extract ONLY facts stated or clearly implied by the list — no outside knowledge, no trivia; 0-8 triples, [] when the list has none worth keeping.
Return ONLY a JSON array: [{"subject":"...","relation":"...","object":"...","domain":"..."}]
${sp.rule()}`
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt: sp.wrap('LIST', listText.slice(0, 8000)),
      temperature: 0,
      maxOutputTokens: 500,
      abortSignal: AbortSignal.timeout(60_000),
    })
    const u = extractUsage(result)
    await recordUsage({ feature: 'refine', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'triples', refId: meta.templateId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const raw = JSON.parse(firstArr(result.text)) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .map((r) => ({
        subject: String((r as Triple)?.subject ?? '').toLowerCase().trim().slice(0, 80),
        relation: String((r as Triple)?.relation ?? '').toLowerCase().trim() as Relation,
        object: String((r as Triple)?.object ?? '').toLowerCase().trim().slice(0, 80),
        domain: String((r as Triple)?.domain ?? '').toLowerCase().trim().slice(0, 40),
      }))
      .filter((t) => t.subject && t.object && (RELATIONS as readonly string[]).includes(t.relation))
      .slice(0, 8)
  } catch (e) {
    await recordUsage({ feature: 'refine', model, input: 0, output: 0, total: 0, cost: 0, refType: 'triples', refId: meta.templateId, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return []
  }
}

/** Сохранить тройки: новая = confidence 1, повтор из другого списка = подтверждение (+1). */
export async function saveTriples(triples: Triple[], lang: string, sourceTemplateId: string): Promise<void> {
  for (const t of triples) {
    await db
      .insert(knowledgeTriples)
      .values({ ...t, lang, sourceTemplateId })
      .onConflictDoUpdate({
        target: [knowledgeTriples.subject, knowledgeTriples.relation, knowledgeTriples.object, knowledgeTriples.lang],
        set: { confidence: sql`${knowledgeTriples.confidence} + 1` },
      })
  }
}

/**
 * «Ремесленные правила» для промпта: тройки по запросу/домену + СВЯЗАННЫЕ с ними
 * через отношения (KAG-2, графовый обход — см. graphRules). Сбой не роняет
 * генерацию: правила — приправа, не блюдо.
 */
export async function craftRules(query: string, domains: string[], limit = 6): Promise<string[]> {
  try {
    const q = query.toLowerCase()
    const clean = domains.filter((d) => d !== '*')
    const rows = await graphRules(q, clean, limit)
    return rows.map((r) => `${r.subject} ${r.relation} ${r.object}${r.confidence > 1 ? ` (confirmed ×${r.confidence})` : ''}`)
  } catch {
    return []
  }
}

interface TripleRow {
  subject: string
  relation: string
  object: string
  confidence: number
}

/**
 * KAG-2 (§5, графовые обходы): не только тройки, чей subject/object совпал с
 * запросом (KAG-1/seed), но и СВЯЗАННЫЕ через отношения — до 2 шагов по графу.
 * Так по «солярис» всплывает вся цепочка порядка чтения (марсианские хроники →
 * … → нейромант), а по ингредиенту — предупреждения и замены соседей.
 * Рекурсивный CTE: seed → шаг по subject=object / object=subject той же lang.
 * UNION (не ALL) гасит циклы, depth≤2 и LIMIT держат обход ограниченным;
 * прямые совпадения (min depth) раньше связанных, дальше по подтверждённости.
 */
async function graphRules(q: string, cleanDomains: string[], limit: number): Promise<TripleRow[]> {
  const domainFilter = cleanDomains.length ? sql`domain = any(${sql.param(cleanDomains)})` : sql`false`
  const res = await db.execute(sql`
    with recursive seed as (
      select subject, relation, object, domain, lang, confidence
      from knowledge_triples
      where ${sql.param(q)} ilike '%' || subject || '%'
         or ${sql.param(q)} ilike '%' || object || '%'
         or ${domainFilter}
      order by confidence desc
      limit 20
    ),
    walk as (
      select subject, relation, object, lang, confidence, 0 as depth from seed
      union
      select kt.subject, kt.relation, kt.object, kt.lang, kt.confidence, w.depth + 1
      from knowledge_triples kt
      join walk w on kt.lang = w.lang and (kt.subject = w.object or kt.object = w.subject)
      where w.depth < 2
    )
    select subject, relation, object, max(confidence)::int as confidence
    from walk
    group by subject, relation, object
    order by min(depth) asc, max(confidence) desc
    limit ${sql.param(limit)}
  `)
  const rows = (res as unknown as { rows?: TripleRow[] }).rows ?? (res as unknown as TripleRow[])
  return Array.isArray(rows) ? rows : []
}

/** Сколько троек в базе — для щитка/страницы гнома. */
export async function tripleCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(knowledgeTriples)
  return r?.n ?? 0
}
