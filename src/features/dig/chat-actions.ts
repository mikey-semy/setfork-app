'use server'

import { and, asc, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { db, digChatMessages, steps, templates, templateVersions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { getRoster } from '@/shared/ai/roster'
import { getAiChatClient } from '@/shared/ai/provider'
import { getAiSettings, isAiAvailable } from '@/shared/settings/ai'
import { pickChatModel } from '@/shared/ai/credits'
import { spotlight } from '@/shared/ai/spotlight'
import { extractUsage, outcomeOf, recordUsage } from '@/shared/ai/usage'
import { aiQuota, globalBudgetOk } from '@/shared/quota'
import { rateLimit } from '@/shared/rate-limit'
import { tr, langEnName, type Lang, type LocaleText } from '@/shared/i18n'
import { parseFollowups } from './followups'

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

export async function digChatAsk(input: {
  templateId: string
  stepN: number
  gnome: string // 'auto' | id из ростера
  history: DigChatMsg[]
  question: string
  lang: Lang
}): Promise<{ who: string; name: string; text: string; followups: string[] } | { error: string }> {
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
  const model = expert.model && forProvider(expert.model) ? expert.model : await pickChatModel(settings)

  const sp = spotlight()
  const guild = expert.code ? `\nGUILD CODE — quality standard you uphold:\n${expert.code}` : ''
  const memory = expert.memory ? `\nYOUR CRAFT MEMORY:\n${sp.wrap('MEMORY', expert.memory)}` : ''
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

  // Аккуратность специалиста (фидбек владельца: повар уверенно отвечал про Homebrew).
  // Вне своего ремесла гном честно предупреждает и отвечает общими знаниями, а не
  // притворяется экспертом. generalist (домены '*') — по любой теме, оговорка не нужна.
  const lane = expert.domains.includes('*')
    ? ''
    : `\nYour craft is: ${expert.domains.join(', ')}. If the question falls OUTSIDE your craft, open with a brief honest note that it's not your specialty (in character), then answer with general knowledge or point to which kind of specialist fits — never fake deep expertise you don't have.`
  const system = `You are ${expert.persona}${guild}${memory}${lane}
You are chatting with a user in the SetFork workshop ABOUT ONE STEP of a list (context below). Dig as deep as they want: reasons, mechanisms, exceptions, alternatives, adjacent techniques — follow THEIR direction. Be concrete; admit "точных данных нет"/"no reliable data" instead of inventing. Keep answers tight (2-5 short paragraphs or a compact list). Answer in ${langEnName(input.lang)}.
You are the guide in this mountain of knowledge — end EVERY reply with one final line "NEXT: q1 | q2 | q3" — three SHORT follow-up questions (max ~6 words each, in the answer language) that dig deeper from what you just said. Nothing after that line.
${sp.rule()}`
  const prompt = `${sp.wrap('STEP', stepCtx)}${hist ? `\n\nCHAT SO FAR:\n${sp.wrap('HISTORY', hist)}` : ''}\n\n${sp.wrap('QUESTION', question)}`

  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: 560, // +60 к ответу под строку NEXT с фоллоу-апами
      abortSignal: AbortSignal.timeout(45_000),
    })
    const u = extractUsage(result)
    await recordUsage({ userId: session.userId, feature: 'dig', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: 'template', refId: tpl.id, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    const raw = result.text.trim()
    if (!raw) return { error: 'aifail' }
    const { text, followups } = parseFollowups(raw)
    if (!text) return { error: 'aifail' }
    // Сессия (фидбек владельца: «беседа исчезла»): пишем вопрос+ответ в БД, чтобы
    // при повторном открытии кирки на пункте разговор восстановился. fire-and-forget:
    // не блокируем ответ, персист — не критичный путь.
    void db
      .insert(digChatMessages)
      .values([
        { templateId: tpl.id, stepN: input.stepN, userId: session.userId, role: 'user', text: question },
        { templateId: tpl.id, stepN: input.stepN, userId: session.userId, role: 'gnome', who: expert.id, text },
      ])
      .catch(() => {})
    return { who: expert.id, name: input.lang === 'ru' ? expert.nameRu : expert.nameEn, text, followups }
  } catch (e) {
    await recordUsage({ userId: session.userId, feature: 'dig', model, input: 0, output: 0, total: 0, cost: 0, refType: 'template', refId: tpl.id, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: client.cfg.provider })
    return { error: 'aifail' }
  }
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
