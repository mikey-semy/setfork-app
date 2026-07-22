'use server'

import { and, asc, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { db, digChatMessages, gnomeThanks, steps, templates, templateVersions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { getRoster, type Expert } from '@/shared/ai/roster'
import { getAiChatClient } from '@/shared/ai/provider'
import { getAiSettings, isAiAvailable } from '@/shared/settings/ai'
import { pickChatModel } from '@/shared/ai/credits'
import { spotlight } from '@/shared/ai/spotlight'
import { extractUsage, outcomeOf, recordUsage } from '@/shared/ai/usage'
import { aiQuota, globalBudgetOk } from '@/shared/quota'
import { rateLimit } from '@/shared/rate-limit'
import { tr, langEnName, type Lang, type LocaleText } from '@/shared/i18n'
import { parseFollowups, parseSummon } from './followups'

/**
 * Мини-чат раскопки (HQ §8, редизайн по фидбеку владельца): вместо статичных
 * трёх слоёв — живой разговор про КОНКРЕТНЫЙ пункт списка с профильным гномом
 * (или выбранным вручную). Контекст старта — список+пункт; дальше любая
 * глубина и любое направление. Сессия эфемерна (история в клиенте, шлём хвост).
 */

export interface DigChatMsg {
  role: 'user' | 'gnome'
  who?: string
  text: string
}

const DIG_RATE_PER_MIN = 6
const HISTORY_TAIL = 8

const fits = (tag: string, domain: string) => tag === domain || (domain.length >= 3 && tag.includes(domain)) || (tag.length >= 3 && domain.includes(tag))

export interface DigReply {
  who: string
  name: string
  text: string
  followups: string[]
}

export async function digChatAsk(input: {
  templateId: string
  stepN: number
  gnome: string // 'auto' | id из ростера
  history: DigChatMsg[]
  question: string
  lang: Lang
}): Promise<{ replies: DigReply[] } | { error: string }> {
  const session = await requireSession()
  const question = (input.question ?? '').trim().slice(0, 500)
  if (!question) return { error: 'empty' }

  const tpl = await db.query.templates.findFirst({ where: eq(templates.id, input.templateId) })
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'not found' }

  // Бюджетная лестница — общая с раскопкой (feature 'dig', тот же rate-ключ).
  if (!(await isAiAvailable()) || !(await getAiSettings()).enabled) return { error: 'ai_off' }
  if (!(await globalBudgetOk())) return { error: 'budget' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'quota' }
  const rl = await rateLimit(`dig:${session.userId}`, DIG_RATE_PER_MIN, 60_000)
  if (!rl.ok) return { error: 'ratelimited' }

  const roster = await getRoster()
  let expert = input.gnome !== 'auto' ? roster.find((e) => e.id === input.gnome) : undefined
  if (!expert) {
    const tags = tpl.tags.map((t) => t.toLowerCase())
    expert =
      roster.find((e) => !e.domains.includes('*') && e.domains.some((d) => tags.some((t) => fits(t, d.toLowerCase())))) ??
      roster.find((e) => e.id === 'generalist') ??
      roster[0]
  }
  if (!expert) return { error: 'ai_off' }

  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.currentVersion)))
  const [row] = ver
    ? await db.select().from(steps).where(and(eq(steps.versionId, ver.id), eq(steps.n, input.stepN))).limit(1)
    : []
  if (!row) return { error: 'not found' }

  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client) return { error: 'ai_off' }
  const forProvider = (m: string) =>
    client.cfg.provider === 'yandex' ? m.startsWith('gpt://') : client.cfg.provider === 'gigachat' ? !m.includes('/') : true

  const sp = spotlight()
  const stepCtx = [
    `List: ${tr(tpl.title as LocaleText, input.lang)}`,
    tpl.tags.length ? `Tags: ${tpl.tags.join(', ')}` : '',
    `Step ${input.stepN}: ${tr(row.title as LocaleText, input.lang)}`,
    tr(row.desc as LocaleText, input.lang),
    row.command ? `Command: ${row.command}` : '',
    tr(row.why as LocaleText, input.lang) ? `Why: ${tr(row.why as LocaleText, input.lang)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const hist = input.history
    .slice(-HISTORY_TAIL)
    .map((m) => `${m.role === 'user' ? 'USER' : 'GNOME'}: ${String(m.text).slice(0, 400)}`)
    .join('\n')

  // Ответить КАК КОНКРЕТНЫЙ гном. allowSummon — можно ли позвать коллегу (только у
  // первого гнома, чтобы не было цепочек созывов). Возвращает текст+фоллоу-апы и,
  // если гном решил передать вопрос, id вызванного специалиста (реальное действие).
  const refId = tpl.id // не-null локаль: сужение `if (!tpl)` не протекает в async-замыкание
  async function answer(e: Expert, allowSummon: boolean): Promise<{ text: string; followups: string[]; summonId?: string } | null> {
    const model = e.model && forProvider(e.model) ? e.model : await pickChatModel(settings)
    const guild = e.code ? `\nGUILD CODE — quality standard you uphold:\n${e.code}` : ''
    const memory = e.memory ? `\nYOUR CRAFT MEMORY:\n${sp.wrap('MEMORY', e.memory)}` : ''
    // Аккуратность специалиста: вне ремесла — честная оговорка (generalist '*' — по всему).
    const lane = e.domains.includes('*')
      ? ''
      : `\nYour craft is: ${e.domains.join(', ')}. If the question falls OUTSIDE your craft, be honest it's not your specialty.`
    // РЕАЛЬНЫЙ СОЗЫВ (идея владельца, MCP-подобное действие гнома): если вопрос
    // явно чужого ремесла и есть подходящий коллега — гном МОЖЕТ позвать его.
    // Это не понарошку: вызванный гном реально войдёт в чат и ответит сам.
    const others = roster.filter((x) => x.id !== e.id && !x.domains.includes('*'))
    const summonBlock =
      allowSummon && !e.domains.includes('*') && others.length
        ? `\nYOU CAN CALL A COLLEAGUE: if this question truly belongs to another craft, hand it off — reply with ONE short in-character line that you're calling them, then on the FINAL line put exactly "SUMMON: <id>" (id from the ROSTER). Use ONLY for a real domain mismatch; if you can answer well yourself, just answer and do NOT summon. When you summon, do NOT add the NEXT line — the colleague will.\nROSTER (id: craft):\n${others.map((x) => `${x.id}: ${x.domains.join(', ')}`).join('\n')}`
        : ''
    const system = `You are ${e.persona}${guild}${memory}${lane}${summonBlock}
You are chatting with a user in the SetFork workshop ABOUT ONE STEP of a list (context below). Dig as deep as they want: reasons, mechanisms, exceptions, alternatives, adjacent techniques — follow THEIR direction. Be concrete; admit "точных данных нет"/"no reliable data" instead of inventing. Keep answers tight (2-5 short paragraphs or a compact list). Answer in ${langEnName(input.lang)}.
Keep the MAIN answer to ~4 sentences so there is room for what follows. You are the guide in this mountain of knowledge — unless you are summoning a colleague, you MUST end EVERY reply with, on its own final line, exactly: "NEXT: q1 | q2 | q3" — three SHORT follow-up questions (max ~6 words each, in the answer language, separated by " | ") that dig deeper. This NEXT line is mandatory (except when summoning); nothing after it.
${sp.rule()}`
    const prompt = `${sp.wrap('STEP', stepCtx)}${hist ? `\n\nCHAT SO FAR:\n${sp.wrap('HISTORY', hist)}` : ''}\n\n${sp.wrap('QUESTION', question)}`
    const startedAt = Date.now()
    try {
      const result = await generateText({
        model: client!.chat(model),
        system,
        prompt,
        temperature: settings.temperature,
        maxOutputTokens: 700,
        abortSignal: AbortSignal.timeout(45_000),
      })
      const u = extractUsage(result)
      await recordUsage({ userId: session.userId, feature: 'dig', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'template', refId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client!.cfg.provider })
      const rawFull = result.text.trim()
      if (!rawFull) return null
      // Реальный созыв: вычленяем «SUMMON: id» (валидный, не сам себя) → отдаём id.
      const parsed = allowSummon ? parseSummon(rawFull) : { text: rawFull, summonId: undefined }
      const summonId = parsed.summonId && others.some((x) => x.id === parsed.summonId) ? parsed.summonId : undefined
      const { text, followups } = parseFollowups(parsed.text)
      if (!text) return null
      return { text, followups, summonId }
    } catch (err) {
      await recordUsage({ userId: session.userId, feature: 'dig', model, input: 0, output: 0, total: 0, cost: 0, refType: 'template', refId, outcome: outcomeOf(err), durationMs: Date.now() - startedAt, provider: client!.cfg.provider })
      return null
    }
  }

  const gname = (e: Expert) => (input.lang === 'ru' ? e.nameRu : e.nameEn)
  const primary = await answer(expert, true)
  if (!primary) return { error: 'aifail' }
  const replies: DigReply[] = [{ who: expert.id, name: gname(expert), text: primary.text, followups: primary.followups }]

  // Настоящий созыв: вызванный гном РЕАЛЬНО входит в чат и отвечает сам (свой
  // персонаж/модель). Глубина 1 — он уже не зовёт дальше (allowSummon=false).
  if (primary.summonId) {
    const target = roster.find((x) => x.id === primary.summonId)
    if (target) {
      const second = await answer(target, false)
      if (second) replies.push({ who: target.id, name: gname(target), text: second.text, followups: second.followups })
    }
  }

  // Сессия: пишем вопрос + ВСЕ реплики гномов (созванный тоже сохраняется).
  void db
    .insert(digChatMessages)
    .values([
      { templateId: tpl.id, stepN: input.stepN, userId: session.userId, role: 'user' as const, text: question },
      ...replies.map((r) => ({ templateId: tpl.id, stepN: input.stepN, userId: session.userId, role: 'gnome' as const, who: r.who, text: r.text })),
    ])
    .catch(() => {})
  return { replies }
}

/**
 * История беседы по пункту для текущего пользователя (сессия): при повторном
 * открытии кирки разговор восстанавливается. Проверяем доступ к списку. Хвост
 * 40 реплик — беседа личная и обычно короткая.
 */
export async function getDigChatHistory(templateId: string, stepN: number): Promise<DigChatMsg[]> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: eq(templates.id, templateId) })
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return []
  // История — НЕ критичный путь: любой сбой запроса (нет таблицы на не-мигрированной
  // дев-БД, транзиент) должен дать пустую сессию, а НЕ ронять страницу в 500
  // (инцидент дев-среды: relation dig_chat_messages does not exist). Запись обёрнута
  // так же — чтение теперь симметрично.
  try {
    const rows = await db
      .select({ role: digChatMessages.role, who: digChatMessages.who, text: digChatMessages.text })
      .from(digChatMessages)
      .where(and(eq(digChatMessages.templateId, templateId), eq(digChatMessages.stepN, stepN), eq(digChatMessages.userId, session.userId)))
      .orderBy(asc(digChatMessages.createdAt))
      .limit(40)
    return rows.map((r) => ({ role: r.role === 'gnome' ? 'gnome' : 'user', who: r.who ?? undefined, text: r.text }))
  } catch {
    return []
  }
}

/**
 * Сказать гному «спасибо» (одушевление): явная благодарность за полезный ответ.
 * Питает настроение (теплеет) и позже — эпизодическую память. Мягкий дедуп: не
 * чаще раза в минуту на гнома от юзера (от случайных двойных кликов), не критично.
 */
export async function thankGnome(who: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession()
  const id = (who ?? '').trim().slice(0, 40)
  if (!id) return { error: 'empty' }
  try {
    const rl = await rateLimit(`thank:${session.userId}:${id}`, 1, 60_000)
    if (!rl.ok) return { ok: true } // уже поблагодарил недавно — тихо принимаем
    await db.insert(gnomeThanks).values({ gnomeId: id, userId: session.userId, source: 'dig' })
    return { ok: true }
  } catch {
    return { ok: true } // благодарность — не критичный путь (нет таблицы/сбой не мешает чату)
  }
}
