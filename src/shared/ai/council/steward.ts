import 'server-only'
import { classifyListKind, LIST_KINDS, type ListKind } from '../list-kind'
import { LAW_KINDS } from '../list-laws'
import type { Expert } from '../roster'
import { firstJson, type CouncilRunner } from './call'

/** Что распорядитель вправе выбрать: всё, кроме типов, которые задаёт закон по запросу. */
const STEWARD_KINDS = LIST_KINDS.filter((k) => !LAW_KINDS.has(k))

/** Решение распорядителя: как глубоко работаем, что за список и кого звать. */
export interface StewardPlan {
  depth: 'single' | 'council'
  kind: ListKind
  /** id названных экспертов как есть — сверку с ростером делает созыв. */
  summoned: string[]
}

/**
 * Распорядитель: глубина витка (адаптивная глубина = лимит цены), ТИП списка и созыв
 * экспертов по домену — всё одним дешёвым вызовом быстрой модели.
 *
 * Тип списка тем же вызовом стоит ~0: это LLM-слой классификации (ADR-0010) поверх
 * грамматического дефолта `classifyListKind`. Выбор пользователя-переключателя
 * (`forcedKind`) ЖЁСТКИЙ — распорядитель его не трогает.
 *
 * Модель промолчала или ответила мусором → «council» и грамматический тип: виток
 * продолжается, просто без уточнения.
 */
export async function askSteward(ctx: {
  run: CouncilRunner
  fast: string
  /** Запрос как есть — по нему работает грамматический классификатор. */
  query: string
  /** Тема в обёртке spotlight. */
  topic: string
  experts: Expert[]
  maxGnomes: number
  forcedKind?: ListKind
  spotlightRule: string
}): Promise<StewardPlan> {
  const { run, fast, query, topic, experts, maxGnomes, forcedKind, spotlightRule } = ctx
  const plan: StewardPlan = { depth: 'council', kind: forcedKind ?? classifyListKind(query), summoned: [] }

  const roster = experts.map((e) => `${e.id}: ${e.persona} [${e.domains.join(',')}]`).join('\n')
  const jsonShape = `{"depth":"single|council","kind":"${STEWARD_KINDS.join('|')}","summon":["id",...],"reason":"short"}`
  const answer = await run(
    fast,
    `You are the steward of a panel of domain experts building a reference list. Choose process depth, the LIST KIND, and summon experts.
- depth "single": the topic is clear AND simple/everyday (chores, basic personal routines) — no council needed.
- depth "council": the topic is clear but technical/multi-faceted/professional — summon 1-${maxGnomes} RELEVANT, DIVERSE experts from the roster.
- kind: what the ELEMENT of the list is. "procedure" = ordered steps to DO (how-to). "inventory" = THINGS to get/have (accessories, gear, ingredients, packing/shopping list). "checklist" = states to verify. "criteria" = rules for choosing/judging. "options" = variants to compare. Pick by what the user actually wants: "what accessories do I need" → inventory, NOT procedure.
MATCH THE TOPIC TO THE ROSTER BY DOMAIN (the topic may be in ANY language): a recipe/dish/cooking → chef; a workout/health → coach; a trip/city → traveler; deploy/servers/CI → devops; code/API/library → coder; study/course → scholar. Use 'generalist' ONLY when nothing fits.
Return ONLY JSON: ${jsonShape}
${spotlightRule}
ROSTER:
${roster}`,
    `REQUEST:\n${topic}`,
    220,
  )
  if (!answer) return plan

  try {
    const p = JSON.parse(firstJson(answer.text)) as { depth?: string; kind?: string; summon?: string[] }
    if (p.depth === 'single') plan.depth = 'single'
    if (!forcedKind && p.kind && (LIST_KINDS as readonly string[]).includes(p.kind)) plan.kind = p.kind as ListKind
    if (Array.isArray(p.summon)) plan.summoned = p.summon
  } catch {
    // не распарсили — дефолт council и грамматический тип
  }
  return plan
}
