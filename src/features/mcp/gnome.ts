import 'server-only'
import { eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { db, users } from '@/shared/db'
import { getAiSettings } from '@/shared/settings/ai'
import { getAiChatClient } from '@/shared/ai/provider'
import { pickChatModel } from '@/shared/ai/credits'
import { getRoster } from '@/shared/ai/roster'
import { buildGnomePrompt, buildReviewPrompt, gnomeCard } from '@/shared/ai/gnome'
import { findPrecedents } from '@/shared/ai/retrieval'
import { detectTextLang } from '@/shared/i18n/detect-text-lang'
import { extractUsage, outcomeOf, recordUsage } from '@/shared/ai/usage'
import { aiQuota, globalBudgetOk } from '@/shared/quota'
import { rateLimit } from '@/shared/rate-limit'
import { mcpGetList } from './tools'

/**
 * Гномы через MCP, этап 1 плана мастерской: list_gnomes (ростер) + ask_gnome
 * (вопрос ОДНОМУ гному, опционально с контекстом списка). Полный совет и
 * gnome_review — следующие этапы (council_draft).
 *
 * Бюджетная лестница ask_gnome — та же, что у генерации: AI включён →
 * глобальный дневной кап → месячная квота пользователя → свой rate-limit
 * (дешёвый одиночный вызов, но внешний клиент может зациклиться).
 */

// Отдельный от HTTP-лимитера кап: 120/мин на токен покрывает чтение, но 120
// LLM-вызовов в минуту — это уже деньги. 10/мин на пользователя достаточно
// для живого диалога и режет петлю агента.
const GNOME_RATE_PER_MIN = Number(process.env.SETFORK_MCP_GNOME_PER_MIN ?? 10)
const CALL_TIMEOUT_MS = 60_000
const MAX_ANSWER_TOKENS = 800
const MAX_LIST_CONTEXT = 4000

export async function mcpListGnomes(): Promise<{ gnomes: ReturnType<typeof gnomeCard>[] }> {
  const roster = await getRoster()
  return { gnomes: roster.map(gnomeCard) }
}

export async function mcpAskGnome(
  userId: string,
  args: { gnome: string; question: string; handle?: string; slug?: string },
): Promise<{ gnome: string; name: { en: string; ru: string }; answer: string } | { error: string }> {
  const roster = await getRoster()
  const expert = roster.find((e) => e.id === args.gnome)
  if (!expert) return { error: `Unknown gnome "${args.gnome}". Call list_gnomes for the roster (ids: ${roster.map((e) => e.id).join(', ')}).` }

  const question = (args.question ?? '').trim()
  if (!question) return { error: 'Empty question' }

  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return { error: 'AI is disabled on this instance' }
  if (!(await globalBudgetOk())) return { error: 'AI budget exhausted for today — try later' }
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  const quota = await aiQuota(userId, u?.handle)
  if (!quota.ok) return { error: 'Your monthly AI quota is used up' }
  const rl = await rateLimit(`mcp:gnome:${userId}`, GNOME_RATE_PER_MIN, 60_000)
  if (!rl.ok) return { error: 'Too many gnome questions — wait a minute' }

  // Контекст списка — опционален и идёт тем же canViewList-чокпоинтом, что get_list.
  let listContext: string | undefined
  if (args.handle && args.slug) {
    const list = await mcpGetList(userId, args.handle, args.slug)
    if (!list) return { error: 'List not found or not accessible' }
    listContext = JSON.stringify(list).slice(0, MAX_LIST_CONTEXT)
  }

  // Личная модель гнома (админка) — если совместима с текущим провайдером; иначе общий выбор.
  const forProvider = (m: string) =>
    client.cfg.provider === 'yandex' ? m.startsWith('gpt://') : client.cfg.provider === 'gigachat' ? !m.includes('/') : true
  const model = expert.model && forProvider(expert.model) ? expert.model : await pickChatModel(settings)

  // Линза гнома (HQ §5 шаг 2): «общий мозг, разные линзы» — вопрос дополняется его
  // аспектами перед embed, из базы приезжают списки и куски-шаги. Пусто на пустом
  // корпусе или при выключенных эмбеддингах — гном отвечает как раньше.
  const lang = detectTextLang(question, 'en')
  const found = await findPrecedents(expert.lens ? `${question}\n${expert.lens}` : question, lang, { userId, limit: 3, stepLimit: 4 })
  const precedents = [
    ...found.lists.map((p) => `${p.title}${p.desc ? ' — ' + p.desc : ''}`),
    ...found.steps.map((s) => s.content.slice(0, 240)),
  ]

  const { system, prompt } = buildGnomePrompt(expert, question, listContext, precedents)
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: MAX_ANSWER_TOKENS,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    const usage = extractUsage(result)
    await recordUsage({ userId, feature: 'mcp-gnome', model, input: usage.input, output: usage.output, total: usage.total, cost: usage.cost, refType: 'mcp', outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return { gnome: expert.id, name: { en: expert.nameEn, ru: expert.nameRu }, answer: result.text.trim() }
  } catch (e) {
    await recordUsage({ userId, feature: 'mcp-gnome', model, input: 0, output: 0, total: 0, cost: 0, refType: 'mcp', outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return { error: 'The gnome could not answer (model call failed) — try again' }
  }
}

/** Матч тега списка и домена гнома — та же формула, что доменная линза. */
const tagFits = (tag: string, domain: string) => tag === domain || tag.includes(domain) || domain.includes(tag)

/**
 * gnome_review (MCP этап 3, HQ §1): гном-мастер смотрит СУЩЕСТВУЮЩИЙ список и
 * даёт правки по кодексу своей гильдии. Гном — явный (параметр) или профильный
 * по тегам списка; та же бюджетная лестница и rate-limit, что ask_gnome.
 */
export async function mcpGnomeReview(
  userId: string,
  args: { handle: string; slug: string; gnome?: string },
): Promise<Record<string, unknown> | { error: string }> {
  const list = await mcpGetList(userId, args.handle, args.slug)
  if (!list) return { error: 'List not found or not accessible' }

  const roster = await getRoster()
  let expert = args.gnome ? roster.find((e) => e.id === args.gnome) : undefined
  if (args.gnome && !expert) return { error: `Unknown gnome "${args.gnome}". Call list_gnomes for the roster.` }
  if (!expert) {
    const tags = ((list as { tags?: string[] }).tags ?? []).map((t) => t.toLowerCase())
    expert =
      roster.find((e) => !e.domains.includes('*') && e.domains.some((d) => tags.some((t) => tagFits(t, d.toLowerCase())))) ??
      roster.find((e) => e.id === 'generalist') ??
      roster[0]
  }
  if (!expert) return { error: 'Roster is empty' }

  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return { error: 'AI is disabled on this instance' }
  if (!(await globalBudgetOk())) return { error: 'AI budget exhausted for today — try later' }
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  if (!(await aiQuota(userId, u?.handle)).ok) return { error: 'Your monthly AI quota is used up' }
  const rl = await rateLimit(`mcp:gnome:${userId}`, GNOME_RATE_PER_MIN, 60_000)
  if (!rl.ok) return { error: 'Too many gnome calls — wait a minute' }

  const forProvider = (m: string) =>
    client.cfg.provider === 'yandex' ? m.startsWith('gpt://') : client.cfg.provider === 'gigachat' ? !m.includes('/') : true
  const model = expert.model && forProvider(expert.model) ? expert.model : await pickChatModel(settings)

  const { system, prompt } = buildReviewPrompt(expert, JSON.stringify(list).slice(0, 6000))
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: 900,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    const usage = extractUsage(result)
    await recordUsage({ userId, feature: 'mcp-gnome', model, input: usage.input, output: usage.output, total: usage.total, cost: usage.cost, refType: 'mcp-review', outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const raw = result.text
    const s = raw.indexOf('{')
    const e2 = raw.lastIndexOf('}')
    let review: unknown = null
    try {
      review = s >= 0 && e2 > s ? JSON.parse(raw.slice(s, e2 + 1)) : null
    } catch {
      review = null
    }
    return {
      gnome: expert.id,
      name: { en: expert.nameEn, ru: expert.nameRu },
      guild: expert.guildEn || undefined,
      // JSON не собрался → честно отдаём сырой текст ревью, клиент разберётся.
      review: review ?? raw.trim(),
    }
  } catch (e) {
    await recordUsage({ userId, feature: 'mcp-gnome', model, input: 0, output: 0, total: 0, cost: 0, refType: 'mcp-review', outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return { error: 'The gnome could not finish the review — try again' }
  }
}
