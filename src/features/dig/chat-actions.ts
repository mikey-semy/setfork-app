'use server'

import { and, asc, eq } from 'drizzle-orm'
import { db, digChatMessages, gnomeThanks, steps, templates, templateVersions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { getRoster, gnomeConverse, type GnomeReply } from '@/shared/ai/gnomes'
import { isAiAvailable } from '@/shared/settings/ai'
import { aiQuota, globalBudgetOk } from '@/shared/quota'
import { rateLimit } from '@/shared/rate-limit'
import { getAiSettings } from '@/shared/settings/ai'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'

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
}): Promise<{ replies: GnomeReply[] } | { error: string }> {
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

  // Единый ДОМ ГНОМОВ (gnomeConverse): весь чат-функционал гнома — характер,
  // настроение, аккуратность, реальный созыв коллеги, фоллоу-апы — живёт там и
  // одинаков во всех поверхностях. Раскопка лишь передаёт контекст пункта.
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

  const replies = await gnomeConverse(expert, question, {
    lang: input.lang,
    context: stepCtx,
    history: hist,
    followups: true,
    summonRoster: roster,
    feature: 'dig',
    refType: 'template',
    refId: tpl.id,
    userId: session.userId,
  })
  if (!replies.length) return { error: 'aifail' }

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
