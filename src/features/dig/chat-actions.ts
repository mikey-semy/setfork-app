'use server'

import { and, asc, eq } from 'drizzle-orm'
import { captureError } from '@/shared/observability'
import { db, digChatMessages, gnomeThanks, steps, templates, templateVersions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { getRoster, gnomeConverse, type GnomeReply } from '@/shared/ai/gnomes'
import { isAiAvailable } from '@/shared/settings/ai'
import { aiQuota, globalBudgetOk } from '@/shared/quota'
import { rateLimit } from '@/shared/rate-limit'
import { getAiSettings } from '@/shared/settings/ai'
import { tr, trLoose, type Lang, type LocaleText } from '@/shared/i18n'
import { pickExpert } from './pick-expert'
import { guideForItem } from './guide'
import { digDepth } from './depth'
import { formatHistory } from './history'
import { craftBasis } from './basis'
import { findPrecedents } from '@/shared/ai/retrieval'

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
  // Текст-блок хранит markdown в content.md (не в desc) — без этого кирка на
  // «Тексте» отдала бы гному пустой контекст.
  const blockMd = row.type === 'text' ? trLoose((row.content as { md?: unknown } | null)?.md, input.lang) : ''

  // КТО СПУСТИТСЯ В ШАХТУ. Порядок: явный выбор человека → проводник по ПУНКТУ (Jev,
  // `guideForItem`) → прежнее правило по тегам СПИСКА (`pickExpert`: мастер по ремеслу,
  // иначе универсал). Последнее — не украшение, а запасной путь: модель может не
  // ответить, бюджет — кончиться, и решение, роняющее запрос, хуже совпадения тегов.
  const chosen = input.gnome && input.gnome !== 'auto' ? roster.find((e) => e.id === input.gnome) : undefined
  const guide = chosen
    ? null
    : await guideForItem(
        {
          templateId: tpl.id,
          version: tpl.currentVersion,
          stepN: input.stepN,
          listTitle: tr(tpl.title as LocaleText, input.lang),
          tags: tpl.tags,
          section: row.section ? tr(row.section as LocaleText, input.lang) : null,
          item: [tr(row.title as LocaleText, input.lang), tr(row.desc as LocaleText, input.lang), blockMd].filter(Boolean).join('\n'),
          userId: session.userId,
        },
        roster,
      )
  const expert = chosen ?? guide?.expert ?? pickExpert(roster, tpl.tags, 'auto')
  if (!expert) return { error: 'ai_off' }
  const stepCtx = [
    `List: ${tr(tpl.title as LocaleText, input.lang)}`,
    tpl.tags.length ? `Tags: ${tpl.tags.join(', ')}` : '',
    `Step ${input.stepN}: ${tr(row.title as LocaleText, input.lang)}`,
    tr(row.desc as LocaleText, input.lang),
    blockMd,
    row.command ? `Command: ${row.command}` : '',
    tr(row.why as LocaleText, input.lang) ? `Why: ${tr(row.why as LocaleText, input.lang)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  // Хвост беседы — с ИМЕНАМИ говоривших (см. `formatHistory`): без них сменившийся
  // мастер принимает реплики предшественника за свои.
  const hist = formatHistory(input.history, roster, input.lang)

  // БАЗА ЗНАНИЙ ГНОМА. Раскопка шла вовсе без прецедентов: гном отвечал из общих знаний
  // модели, а наша библиотека — то, чем он отличается от чат-бота, — не участвовала.
  // Берём прецеденты по шагу и режем ЕГО доменной линзой: повар видит рецепты, а не
  // деплой. Если по его ремеслу ничего не нашлось, он об этом скажет прямо (иначе
  // «основано на нашей библиотеке» звучит одинаково и когда основано, и когда нет).
  const found = await findPrecedents(
    `${tr(tpl.title as LocaleText, input.lang)}: ${tr(row.title as LocaleText, input.lang)}`,
    input.lang,
    { userId: session.userId, limit: 3, stepLimit: 3 },
  )
  // Списки И шаги, отобранные линзой его ремесла (см. `craftBasis`).
  const { precedents, offCraft } = craftBasis(found, expert.domains)

  const replies = await gnomeConverse(expert, question, {
    lang: input.lang,
    context: stepCtx,
    history: hist,
    precedents,
    precedentsOffCraft: offCraft,
    // СЛОЙ РАСКОПКИ. Глубина = на сколько вопросов по этому шагу уже ответили: первый ответ
    // про причины и источники, второй про механизм и исключения, третий про тонкости.
    // Без этого разговор топтался на одном уровне — человек спрашивал третий раз и
    // получал ту же глубину, что в первый, хотя в лоре «копать» это идти слой за слоем.
    depth: digDepth(input.history),
    followups: true,
    summonRoster: roster,
    feature: 'dig',
    refType: 'template',
    refId: tpl.id,
    userId: session.userId,
  })
  // Теневой вопрос о ремесле шёл параллельно с ответом гнома — дожидаемся записи.
  await guide?.shadow
  if (!replies.length) return { error: 'aifail' }

  // Сессия: пишем вопрос + ВСЕ реплики гномов (созванный тоже сохраняется).
  // Ответ не задерживаем — но и потерю не прячем: молчаливый `.catch(() => {})`
  // означал бы, что беседа «сохранена» ровно до следующего открытия кирки.
  void db
    .insert(digChatMessages)
    .values([
      { templateId: tpl.id, stepN: input.stepN, userId: session.userId, role: 'user' as const, text: question },
      ...replies.map((r) => ({ templateId: tpl.id, stepN: input.stepN, userId: session.userId, role: 'gnome' as const, who: r.who, text: r.text })),
    ])
    .catch((e) => captureError(e, { where: 'digChatAsk.save', templateId: tpl.id, stepN: input.stepN }))
  return { replies }
}

/**
 * История беседы по пункту для текущего пользователя (сессия): при повторном
 * открытии кирки разговор восстанавливается. Проверяем доступ к списку. Хвост
 * 40 реплик — беседа личная и обычно короткая.
 *
 * ⚠️ СБОЙ ОТЛИЧАЕТСЯ ОТ ПУСТОТЫ, И ЭТО НЕ ПЕДАНТИЗМ. Раньше любая беда — обрыв связи,
 * упавший запрос — возвращала пустой массив, и человек видел чат без единого
 * сообщения, будто беседы никогда не было. Владелец на этом и попался: «спрашивал,
 * метка стоит, а истории нет» — на самом деле был сбой сети, история жива.
 * Пустая беседа и недоступная беседа — разные вещи, и говорить о них надо разное.
 */
export type DigChatHistory = { ok: true; messages: DigChatMsg[] } | { ok: false }

export async function getDigChatHistory(templateId: string, stepN: number): Promise<DigChatHistory> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: eq(templates.id, templateId) })
  // Нет доступа к списку — беседы для этого зрителя и правда нет.
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { ok: true, messages: [] }
  try {
    const rows = await db
      .select({ role: digChatMessages.role, who: digChatMessages.who, text: digChatMessages.text })
      .from(digChatMessages)
      .where(and(eq(digChatMessages.templateId, templateId), eq(digChatMessages.stepN, stepN), eq(digChatMessages.userId, session.userId)))
      .orderBy(asc(digChatMessages.createdAt))
      .limit(40)
    return {
      ok: true,
      messages: rows.map((r) => ({ role: r.role === 'gnome' ? 'gnome' : 'user', who: r.who ?? undefined, text: r.text })),
    }
  } catch (e) {
    // Не роняем страницу (на не-мигрированной дев-БД таблицы может не быть), но и не
    // выдаём сбой за пустую беседу: причина уходит в лог, зритель получает «не
    // удалось загрузить» с кнопкой повтора.
    captureError(e, { where: 'getDigChatHistory', templateId, stepN })
    return { ok: false }
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
