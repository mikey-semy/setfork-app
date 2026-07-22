import 'server-only'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { generateText } from 'ai'
import { councilExperts, db, generationCandidates, generationMessages, generations } from '@/shared/db'
import { getRosterAll } from '@/shared/ai/roster'
import { getAiChatClient } from '@/shared/ai/provider'
import { getAiSettings } from '@/shared/settings/ai'
import { pickChatModel } from '@/shared/ai/credits'
import { extractUsage, outcomeOf, recordUsage } from '@/shared/ai/usage'

/**
 * Найм (рождение) гнома — HQ §4в: универсала зовут слишком часто по темам,
 * где нет профильного мастера → предлагаем админу нанять нового. Знания ≠
 * навыки (§6): база общая, найм = один профиль в council_experts.
 */

export interface HireSignal {
  tag: string
  n: number
}

/** Матч тега и домена — та же логика, что доменная линза прецедентов (pickPrecedents). */
const covers = (tag: string, domain: string) => tag === domain || (domain.length >= 3 && tag.includes(domain)) || (tag.length >= 3 && domain.includes(tag))

/**
 * Сигнал найма: теги кандидатов за 30 дней из генераций, где черновик писал
 * гном-универсал ('*'), НЕ покрытые доменами профильных гномов. Чистая
 * агрегация — без LLM, считается при открытии зала совета.
 */
export async function hireSignals(): Promise<HireSignal[]> {
  const roster = await getRosterAll()
  const generalists = roster.filter((e) => e.domains.includes('*')).map((e) => e.id)
  if (!generalists.length) return []
  const domains = roster.filter((e) => e.enabled && !e.domains.includes('*')).flatMap((e) => e.domains.map((d) => d.toLowerCase()))

  const genIds = db
    .select({ id: generations.id })
    .from(generations)
    .innerJoin(generationMessages, eq(generationMessages.generationId, generations.id))
    .where(and(eq(generationMessages.kind, 'draft'), inArray(generationMessages.who, generalists), gte(generations.createdAt, sql`now() - interval '30 days'`)))
  const rows = await db
    .select({ tag: sql<string>`unnest(${generationCandidates.tags})`, n: sql<number>`count(*)::int` })
    .from(generationCandidates)
    .where(inArray(generationCandidates.generationId, genIds))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`)
    .limit(30)

  return rows
    .map((r) => ({ tag: r.tag.toLowerCase().trim(), n: r.n }))
    .filter((r) => r.tag && r.n >= 2 && !domains.some((d) => covers(r.tag, d)))
    .slice(0, 5)
}

export interface HireDraft {
  id: string
  nameEn: string
  nameRu: string
  guildEn: string
  guildRu: string
  persona: string
  code: string
  lens: string
  domains: string[]
}

const firstJson = (t: string) => {
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}

/**
 * Черновик профиля нового гнома под тему: LLM подбирает ПРИЗНАННЫЙ профстандарт
 * как каркас персоны (как HACCP у повара, SRE Book у девопсера). Гном рождается
 * ВЫКЛЮЧЕННЫМ — админ читает, правит и включает сам.
 */
export async function draftHire(tag: string, userId: string): Promise<HireDraft | null> {
  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return null
  const model = await pickChatModel(settings)
  const system = `You design ONE new expert "gnome" for the SetFork workshop council, specialised in the topic given. Ground the persona in a RECOGNISED professional standard or canonical book for that field (like HACCP for chefs, the Google SRE Book for devops, CRAAP for research) and NAME it inside the persona. Persona is a working instruction, written like: "a <profession>. <3-5 dense sentences of concrete working rules from the standard>". Return ONLY JSON:
{"id":"<latin-slug>","nameEn":"<short role name>","nameRu":"<короткое имя роли по-русски>","guildEn":"<... Guild>","guildRu":"Гильдия <...>","persona":"<EN working instruction>","code":"- <4 short quality-standard bullets in EN>","lens":"<5-7 EN search keywords>","domains":["5-7 lowercase EN topic tags"]}`
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt: `Topic that keeps reaching the generalist: "${tag}". Design the specialist gnome.`,
      temperature: 0.4,
      maxOutputTokens: 700,
      abortSignal: AbortSignal.timeout(60_000),
    })
    const u = extractUsage(result)
    await recordUsage({ userId, feature: 'generate', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'hire', outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const p = JSON.parse(firstJson(result.text)) as Partial<HireDraft>
    const id = String(p.id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24)
    if (!id || !p.nameEn || !p.persona) return null
    return {
      id,
      nameEn: String(p.nameEn).slice(0, 40),
      nameRu: String(p.nameRu ?? p.nameEn).slice(0, 40),
      guildEn: String(p.guildEn ?? '').slice(0, 60),
      guildRu: String(p.guildRu ?? '').slice(0, 60),
      persona: String(p.persona).slice(0, 2000),
      code: String(p.code ?? '').slice(0, 1200),
      lens: String(p.lens ?? '').slice(0, 200),
      domains: Array.isArray(p.domains) ? p.domains.map((d) => String(d).toLowerCase().trim()).filter(Boolean).slice(0, 7) : [tag],
    }
  } catch (e) {
    await recordUsage({ userId, feature: 'generate', model, input: 0, output: 0, total: 0, cost: 0, refType: 'hire', outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return null
  }
}

/** Нанять: вставить профиль ВЫКЛЮЧЕННЫМ (enabled=false) в конец ростера. Возвращает id или null. */
export async function insertHired(draft: HireDraft): Promise<string | null> {
  const [{ maxSort }] = await db.select({ maxSort: sql<number>`coalesce(max(${councilExperts.sort}), 0)::int` }).from(councilExperts)
  const rows = await db
    .insert(councilExperts)
    .values({
      id: draft.id,
      nameEn: draft.nameEn,
      nameRu: draft.nameRu,
      guildEn: draft.guildEn,
      guildRu: draft.guildRu,
      persona: draft.persona,
      code: draft.code,
      lens: draft.lens,
      domains: draft.domains,
      model: '',
      // Встроенной картинки под новый id нет — временно generalist, админ выберет в галерее.
      avatar: 'generalist',
      avatarUploaded: false,
      online: false,
      enabled: false,
      sort: maxSort + 1,
    })
    .onConflictDoNothing()
    .returning({ id: councilExperts.id })
  return rows[0]?.id ?? null
}
