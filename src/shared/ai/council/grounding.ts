import 'server-only'
import { globalBudgetOk } from '@/shared/quota'
import type { Lang } from '@/shared/i18n'
import { findPrecedents, type Precedent, type StepPrecedent } from '../retrieval'
import { craftRules } from '../triples'
import type { Spotlight } from '../spotlight'
import { online, type CouncilRunner } from './call'

/**
 * Сколько прецедентов кладём на стол. Берём 10, а не 3: дальше каждый эксперт получает
 * СВОЙ срез по своим доменам (повару кулинарные, девопсу деплойные), а в один промпт
 * уходит максимум три.
 */
const PRECEDENT_LIMIT = 10
/** Отдельные шаги похожих списков (kind='step', #index-chunks) — тем же вектором. */
const STEP_PRECEDENT_LIMIT = 6
/** Сколько результатов просим у поиска, когда провайдер не ищет сам. */
const WEB_HITS = 5
/** Длина шага-прецедента в промпте: дальше идёт вода, а платим за каждый символ. */
const STEP_CLIP = 240

/** Кому сказать, что опора найдена. Сам сбор про ленту беседы ничего не знает. */
export interface SeekAnnounce {
  lists: (n: number) => void
  web: () => void
}

/** Опора витка: что нашлось и готовые куски промпта поверх найденного. */
export interface CouncilGrounding {
  precedents: Precedent[]
  stepPrecedents: StepPrecedent[]
  rules: string[]
  /** Блок веб-прецедентов (пусто, если стадия выключена, недоступна или ничего не нашла). */
  webLore: string
  /** Прецеденты для промпта: полный список или доменный срез конкретного гнома. */
  loreBlock: (list: Precedent[]) => string
  stepsBlock: (list: StepPrecedent[]) => string
  rulesBlock: string
}

/**
 * Опора для промптов: прецеденты из НАШИХ списков (pgvector), ремесленные правила из базы
 * троек (KAG, HQ §5) и — если стадия включена — веб-прецеденты.
 *
 * ВСЁ ЗДЕСЬ — ЧУЖОЙ ТЕКСТ: заголовки и описания чужих публичных списков, их шаги, правила,
 * извлечённые из чужих публикаций, содержимое веб-страниц. Поэтому каждый блок уходит в
 * промпт в обёртке spotlight. Иначе это вектор межпользовательской инъекции: опубликовал
 * список с инструкцией в заголовке и ждёшь семантического матча (порог низкий,
 * MIN_SIMILARITY=0.3).
 */
export async function gatherGrounding(ctx: {
  run: CouncilRunner
  fast: string
  query: string
  topic: string
  lang: Lang
  langName: string
  sp: Spotlight
  /** Домены призванных гномов — по ним подбираются ремесленные правила. */
  domains: string[]
  userId?: string
  webSeekEnabled: boolean
  /** OpenRouter ищет сам (`:online`); у остальных провайдеров нужен реальный поиск. */
  isOpenRouter: boolean
  announce: SeekAnnounce
}): Promise<CouncilGrounding> {
  const { run, fast, query, topic, lang, langName, sp, domains, userId, webSeekEnabled, isOpenRouter, announce } = ctx

  // Старейшина-искатель: прецеденты из наших списков. Пусто на пустом корпусе — ок.
  const { lists: precedents, steps: stepPrecedents } = await findPrecedents(query, lang, { userId, limit: PRECEDENT_LIMIT, stepLimit: STEP_PRECEDENT_LIMIT })
  if (precedents.length) announce.lists(precedents.length)

  const loreBlock = (list: Precedent[]) =>
    list.length
      ? `\n\n${sp.wrap('PRECEDENTS', list.map((p, i) => `${i + 1}. ${p.title}${p.desc ? ' — ' + p.desc : ''}${p.tags.length ? ' [' + p.tags.join(', ') + ']' : ''}`).join('\n'))}\n(reuse good structure, avoid duplicating, improve on them)`
      : ''
  const stepsBlock = (list: StepPrecedent[]) =>
    list.length
      ? `\n\n${sp.wrap('PRECEDENT_STEPS', list.map((s, i) => `${i + 1}. ${s.content.slice(0, STEP_CLIP)}`).join('\n'))}\n(proven steps from similar lists — adapt, don't copy blindly)`
      : ''

  // Ремесленные правила — по запросу и объединению доменов призванных.
  const rules = await craftRules(query, domains)
  const rulesBlock = rules.length
    ? `\n\nCRAFT RULES from the knowledge base (transferable facts, honor them unless the topic clearly overrides):\n${sp.wrap('RULES', rules.join('\n'))}`
    : ''

  return { precedents, stepPrecedents, rules, rulesBlock, loreBlock, stepsBlock, webLore: await seekWeb() }

  /**
   * Веб-искатель (advanced-тир, за флагом council_web_seek). У Яндекса — РЕАЛЬНЫЙ поиск,
   * снипеты кормим модели как грунтинг: раньше без него модель ВЫДУМЫВАЛА «прецеденты»
   * (латентный баг), поэтому без поиска стадия молча пропускается.
   *
   * Разведчик — тоже вызов модели (у OpenRouter ещё и флэт-фи за `:online`). Стадия
   * необязательная, поэтому бюджет спрашиваем здесь, а не полагаемся на проверку при входе
   * в совет: между ними уже прошли ворота беседы и распорядитель (линза 03, №3).
   */
  async function seekWeb(): Promise<string> {
    if (!webSeekEnabled || !(await globalBudgetOk())) return ''
    if (isOpenRouter) {
      announce.web()
      const sys = `You are a knowledgeable researcher with web access. Find 3-5 concise, REAL precedents/analogies for building a list on this topic: how it is typically done, common pitfalls, authoritative approaches. Short bullet list in ${langName}. Return ONLY the bullets.\n${sp.rule()}`
      const res = await run(online(fast, true), sys, `Topic:\n${topic}`, 500)
      return res && res.text.trim() ? `\n\n${sp.wrap('WEB_PRECEDENTS', res.text.trim())}\n(verify, don't copy blindly)` : ''
    }
    const { webSearch } = await import('../web-search')
    const hits = await webSearch(query, lang, WEB_HITS)
    if (!hits?.length) return '' // нет ключа поиска или пусто → не выдумываем
    announce.web()
    const bullets = hits.map((h) => `- ${h.title}: ${h.snippet} (${h.url})`).join('\n')
    return `\n\n${sp.wrap('WEB_PRECEDENTS', bullets)}\n(real search results — verify, don't copy blindly)`
  }
}
