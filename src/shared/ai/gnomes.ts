import 'server-only'
import { generateText } from 'ai'
import { getAiChatClient } from './provider'
import { getAiSettings } from '@/shared/settings/ai'
import { pickChatModel } from './credits'
import { extractUsage, outcomeOf, recordUsage, type AiFeature } from './usage'
import { spotlight } from './spotlight'
import { getRoster, type Expert } from './roster'
import { gnomeCard } from './gnome-character'
import { gnomeMood, gnomeReputation, gnomeThanksCounts, gnomeUserThanks } from './gnome-reputation'
import { parseFollowups, parseSummon } from './reply-parse'
import { langEnName, type Lang } from '@/shared/i18n'

/**
 * ДОМ ГНОМОВ — единый источник правды для чата гнома (идея владельца: не
 * дублировать функционал, чтобы гном работал ОДИНАКОВО везде — в генерации,
 * раскопках, MCP, редакторе). Здесь живёт ДВИЖОК голоса: как гном отвечает,
 * с характером, настроением, аккуратностью, реальным созывом коллеги и
 * фоллоу-апами. Каждая поверхность зовёт gnomeSpeak/gnomeConverse, а не строит
 * свой промпт. Реэкспорт ростера/характера/настроения — чтобы «дом» был одной
 * точкой входа.
 */
export { getRoster, type Expert } from './roster'
export { gnomeCard, rivalryHints } from './gnome-character'
export { gnomeMood, gnomeReputation, gnomeThanksCounts, gnomeUserThanks, repScore, REP_MIN_GENS } from './gnome-reputation'

const CALL_TIMEOUT_MS = 45_000

export interface GnomeReply {
  who: string
  name: string
  text: string
  followups: string[]
}

export interface GnomeSpeakOpts {
  lang: Lang
  /** Контекст (список/шаг) — недоверенный текст, оборачивается спотлайтом. */
  context?: string
  /** Хвост беседы (уже отформатированный вызывающим). */
  history?: string
  /** Прецеденты из базы (KAG/retrieval) — «использовать, не копировать вслепую». */
  precedents?: string[]
  /** short: одна короткая реплика (диалог-реакция), без фоллоу-апов/созыва. */
  short?: boolean
  /** Добавлять строку NEXT (фоллоу-апы) — для чат-поверхностей, ведущих вглубь. */
  followups?: boolean
  /** Ростер для реального созыва: гном может передать вопрос коллеге. */
  summonRoster?: Expert[]
  feature: AiFeature
  refType?: 'template' | 'generation' | 'mcp'
  refId?: string
  userId?: string | null
  maxTokens?: number
}

const forProviderOf = (provider: string) => (m: string) =>
  provider === 'yandex' ? m.startsWith('gpt://') : provider === 'gigachat' ? !m.includes('/') : true

/**
 * Единый ответ гнома. Строит промпт из ВСЕХ граней личности (персона, кодекс,
 * память, характер+настроение, аккуратность), исполняет, учитывает расход,
 * разбирает NEXT/SUMMON. Возвращает нормализованную реплику или null.
 */
export async function gnomeSpeak(
  e: Expert,
  question: string,
  opts: GnomeSpeakOpts,
): Promise<{ text: string; followups: string[]; summonId?: string } | null> {
  const client = await getAiChatClient()
  if (!client) return null
  const settings = await getAiSettings()
  const forProvider = forProviderOf(client.cfg.provider)
  const model = e.model && forProvider(e.model) ? e.model : await pickChatModel(settings)

  const sp = spotlight()
  const guild = e.code ? `\nGUILD CODE — quality standard you uphold:\n${e.code}` : ''
  const memory = e.memory ? `\nYOUR CRAFT MEMORY:\n${sp.wrap('MEMORY', e.memory)}` : ''
  // Характер + настроение — ЕДИНО для всех поверхностей (раньше только у совета).
  const card = gnomeCard(e.id)
  const [rep, thanks] = await Promise.all([gnomeReputation(), gnomeThanksCounts()])
  const mood = gnomeMood(rep, e.id, thanks[e.id] ?? 0).style

  // Эпизодическая память о СОБЕСЕДНИКЕ (идея владельца «запомнит и будет добрым»):
  // гном узнаёт вернувшегося человека, который благодарил его раньше. Гейт на общем
  // счётчике благодарностей — точечный запрос лишь у гномов, кого вообще благодарили.
  // Тонко и в характере: тёплый кивок, не подобострастие; 0 → строки нет (только факт).
  let bond = ''
  if (opts.userId && (thanks[e.id] ?? 0) > 0) {
    const ut = await gnomeUserThanks(e.id, opts.userId).catch(() => 0)
    if (ut > 0)
      bond = `\nYOU REMEMBER THIS PERSON: they have thanked you before${ut >= 3 ? ' several times — a familiar, valued face' : ''}. A brief, genuine note of recognition fits if it feels natural — warm, never servile or overfamiliar.`
  }

  const persona = `You are ${e.persona}
Character: ${card.trait}; your quirk — ${card.quirk}.${mood ? ` Mood right now: ${mood}.` : ''}${bond}${guild}${memory}`

  // Аккуратность специалиста: вне ремесла — честная оговорка (generalist '*' — по всему).
  const lane = e.domains.includes('*')
    ? ''
    : `\nYour craft is: ${e.domains.join(', ')}. If the question falls OUTSIDE your craft, be honest it's not your specialty.`

  // Реальный созыв коллеги (MCP-подобное действие): только если дан ростер и гном не универсал.
  const others = (opts.summonRoster ?? []).filter((x) => x.id !== e.id && !x.domains.includes('*'))
  const canSummon = !opts.short && others.length > 0 && !e.domains.includes('*')
  const summonBlock = canSummon
    ? `\nYOU CAN CALL A COLLEAGUE: if this question truly belongs to another craft, hand it off — reply with ONE short in-character line that you're calling them, then on the FINAL line put exactly "SUMMON: <id>" (id from ROSTER). Only for a real domain mismatch; if you can answer well, just answer. When summoning, do NOT add the NEXT line.\nROSTER (id: craft):\n${others.map((x) => `${x.id}: ${x.domains.join(', ')}`).join('\n')}`
    : ''

  const followupsRule =
    opts.followups && !opts.short
      ? `\nYou are the guide in this mountain of knowledge — unless you are summoning a colleague, you MUST end EVERY reply with, on its own final line, exactly: "NEXT: q1 | q2 | q3" — three SHORT follow-up questions (max ~6 words each, in the answer language, separated by " | "). Mandatory (except when summoning); nothing after it.`
      : ''

  const task = opts.short
    ? `A user just spoke to you in the workshop chat. Reply with ONE short in-character line (max 120 chars, no quotes): acknowledge and say concretely what you will do. Answer in ${langEnName(opts.lang)}.`
    : `A user is talking to you in the SetFork workshop. Answer as this expert — practical, specific, in character; admit "no reliable data" instead of inventing. Keep it tight (2-5 short paragraphs or a compact list)${opts.followups ? ', ~4 sentences so there is room for the NEXT line' : ''}. Answer in ${langEnName(opts.lang)}.`

  const lore = opts.precedents?.length
    ? `\n\nFrom the SetFork knowledge base (use what helps, don't copy blindly):\n${sp.wrap('PRECEDENTS', opts.precedents.join('\n'))}`
    : ''
  const system = `${persona}${lane}${summonBlock}
${task}${followupsRule}
${sp.rule()}`
  const prompt = `${opts.context ? `${sp.wrap('CONTEXT', opts.context)}\n\n` : ''}${opts.history ? `CHAT SO FAR:\n${sp.wrap('HISTORY', opts.history)}\n\n` : ''}${sp.wrap('QUESTION', question)}${lore}`

  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: opts.maxTokens ?? (opts.short ? 140 : 700),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    const u = extractUsage(result)
    await recordUsage({ userId: opts.userId ?? null, feature: opts.feature, model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType, refId: opts.refId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    let raw = result.text.trim()
    if (!raw) return null
    if (opts.short) return { text: raw.replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 160), followups: [] }
    let summonId: string | undefined
    if (canSummon) {
      const s = parseSummon(raw)
      if (s.summonId && others.some((x) => x.id === s.summonId)) {
        summonId = s.summonId
        raw = s.text
      }
    }
    const { text, followups } = parseFollowups(raw)
    if (!text) return null
    return { text, followups, summonId }
  } catch (err) {
    await recordUsage({ userId: opts.userId ?? null, feature: opts.feature, model, input: 0, output: 0, total: 0, cost: 0, refType: opts.refType, refId: opts.refId, outcome: outcomeOf(err), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return null
  }
}

const gname = (e: Expert, lang: Lang) => (lang === 'ru' ? e.nameRu : e.nameEn)

/**
 * Полный ход чата: гном отвечает, и если он РЕАЛЬНО созвал коллегу — тот входит
 * и отвечает сам (глубина 1). Возвращает массив реплик (обычно 1, при созыве 2).
 * Единая механика для всех поверхностей — дом гномов.
 */
export async function gnomeConverse(primary: Expert, question: string, opts: GnomeSpeakOpts): Promise<GnomeReply[]> {
  const first = await gnomeSpeak(primary, question, opts)
  if (!first) return []
  const replies: GnomeReply[] = [{ who: primary.id, name: gname(primary, opts.lang), text: first.text, followups: first.followups }]
  if (first.summonId && opts.summonRoster) {
    const target = opts.summonRoster.find((x) => x.id === first.summonId)
    if (target) {
      const second = await gnomeSpeak(target, question, { ...opts, summonRoster: undefined }) // созванный дальше не зовёт
      if (second) replies.push({ who: target.id, name: gname(target, opts.lang), text: second.text, followups: second.followups })
    }
  }
  return replies
}
