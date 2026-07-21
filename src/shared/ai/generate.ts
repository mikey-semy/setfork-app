import 'server-only'
import { generateText } from 'ai'
import { getAiSettings } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { extractUsage, outcomeOf, recordUsage, type AiFeature } from './usage'
import { sanitizeCommand } from './sanitize-command'
import { lawBlock } from './list-laws'
import { classifyListKind, shapeFor, type ListKind } from './list-kind'
import { detailRule, DEFAULT_DETAIL, type DetailLevel } from './detail-level'
import { spotlight } from './spotlight'
import { langEnName, type Lang } from '@/shared/i18n'

// Потолок размера входного промта (символы). Спасает от раздувания input-токенов
// на огромных списках; middle-out у провайдера — вторая линия обороны.
const MAX_PROMPT_CHARS = 12_000

export { sanitizeCommand }

export interface GeneratedRef {
  label: string
  url: string
}
export interface GeneratedItem {
  title: string
  desc: string
  command: string
  /** Заголовок группы-секции (напр. рецепт: «Ингредиенты»/«Приготовление»). '' — без секции.
   *  Опционально: parseList всегда его ставит, но внешние конструкторы (напр. садовник) — нет. */
  section?: string
  level: 'required' | 'recommended' | 'optional'
  why: string
  subtasks: string[]
  refs: GeneratedRef[]
}
export interface GeneratedList {
  title: string
  desc: string
  tags: string[]
  items: GeneratedItem[]
}

export interface GenerateOptions {
  /** Веб-поиск (OpenRouter `:online`) — список ближе к реальности. */
  web?: boolean
  /** Вариативность: подсказка «сделай ИНАЧЕ» для перегенерации (variant 2, 3…). */
  variant?: number
  /** Тип списка (ADR-0010): переопределяет автоклассификацию (переключатель в чате). */
  kind?: ListKind
  /** Объём: короче / обычный / подробнее (переключатель на старте и в чате). */
  detail?: DetailLevel
  /** Для учёта расхода: кто вызвал, какая фича, к чему относится. */
  userId?: string
  feature?: AiFeature
  refType?: string
  refId?: string
}

/**
 * Форма JSON, ЗАВИСЯЩАЯ ОТ ТИПА СПИСКА (ADR-0010). Структура одна (CandidateItem переиспользуется),
 * меняется смысл элемента — блок shapeFor(kind). Раньше форма была захардкожена как процедура, и
 * запрос про «список вещей» приходил процедурой. По умолчанию kind='procedure' — прежнее поведение.
 */
export function jsonShapeFor(kind: ListKind = 'procedure'): string {
  return `Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "section": string, "level": "required"|"recommended"|"optional", "why": string, "subtasks": string[], "refs": [{"label": string, "url": string}]}]}
Rules:
- title: concise noun phrase naming the list.
- desc: one sentence describing it.
- tags: 3-6 short lowercase tags, no '#'.
- refs: put ALL URLs here (never in command). Each ref: label = short human name, url = full https URL. Use [] when there is no good link.
- command: ONLY a REAL, runnable shell/CLI command (git, docker, npm, psql…). If the step is not technical — cooking, everyday life, physical actions, reading, decisions — leave it "". NEVER turn prose into a fake command (e.g. "boil water", "buy milk", "call the vendor").
- section: a group heading for the item; "" unless the list type below asks to split items into groups.
${shapeFor(kind)}`
}

/** Форма процедуры — для мест, которые СОХРАНЯЮТ структуру исходника (перевод, refine), а не выбирают тип. */
export const JSON_SHAPE = jsonShapeFor('procedure')

export function parseList(text: string, fallbackTitle: string): GeneratedList | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj: Partial<GeneratedList>
  try {
    obj = JSON.parse(cleaned) as Partial<GeneratedList>
  } catch {
    return null
  }
  const LEVELS = ['required', 'recommended', 'optional']
  const items: GeneratedItem[] = Array.isArray(obj.items)
    ? obj.items
        .slice(0, 20)
        .map((it) => ({
          title: String(it?.title ?? '').trim(),
          desc: String(it?.desc ?? '').trim(),
          command: sanitizeCommand(String(it?.command ?? '')),
          level: (LEVELS.includes(String(it?.level)) ? String(it?.level) : 'required') as GeneratedItem['level'],
          why: String(it?.why ?? '').trim(),
          subtasks: Array.isArray(it?.subtasks) ? it.subtasks.map((s) => String(s).trim()).filter(Boolean).slice(0, 6) : [],
          refs: Array.isArray(it?.refs)
            ? it.refs
                .map((r) => ({ label: String(r?.label ?? '').trim(), url: String(r?.url ?? '').trim() }))
                .filter((r) => r.label && /^https?:\/\//i.test(r.url))
                .slice(0, 3)
            : [],
        }))
        .filter((it) => it.title)
    : []
  if (!items.length) return null
  return {
    title: String(obj.title ?? fallbackTitle).trim().slice(0, 140),
    desc: String(obj.desc ?? '').trim(),
    tags: Array.isArray(obj.tags) ? obj.tags.map((t) => String(t)) : [],
    items,
  }
}

/** Общий прогон модели: генерация текста + учёт расхода + парс JSON-списка. */
async function runListModel(
  system: string,
  prompt: string,
  fallbackTitle: string,
  feature: AiFeature,
  opts: GenerateOptions,
): Promise<GeneratedList | null> {
  const client = await getAiChatClient()
  if (!client) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null // глобальный дневной кап расхода исчерпан

  // :online-суффикс, models-фолбэк и middle-out — механики OpenRouter; на других
  // провайдерах зовём голую модель (веб-поиска и авто-фолбэка там нет).
  const isOpenRouter = client.cfg.provider === 'openrouter'
  const web = (opts.web ?? false) && isOpenRouter
  const base = await pickChatModel(settings)
  const online = (m: string) => (web && m ? `${m}:online` : m)
  const models = [base, settings.fallbackModel].filter((v, i, a) => v && a.indexOf(v) === i).map(online)

  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(online(base), isOpenRouter ? { extraBody: { models, transforms: ['middle-out'] } } : undefined),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
    })
    // parseList чистый и не бросает — можно узнать исход ДО записи расхода:
    // невалидный JSON = outcome 'invalid' (токены потрачены в любом случае).
    const parsed = parseList(result.text, fallbackTitle)
    const u = extractUsage(result)
    await recordUsage({
      userId: opts.userId,
      feature,
      // ИМЕННО online(base), а не base: у `:online` своя флэт-надбавка ($0.005/вызов у OpenRouter),
      // и с голым base журнал показывал «дорогой gpt-4o-mini» вместо «веб-поиск» — из-за чего 60%
      // расхода были не видны в админке вообще. Пишем то, что реально звали.
      model: online(base),
      input: u.input,
      output: u.output,
      total: u.total,
      cost: u.cost,
      refType: opts.refType,
      refId: opts.refId,
      outcome: parsed ? 'ok' : 'invalid',
      durationMs: Date.now() - startedAt,
    })
    return parsed
  } catch (e) {
    await recordUsage({
      userId: opts.userId,
      feature,
      model: online(base),
      input: 0,
      output: 0,
      total: 0,
      cost: 0,
      refType: opts.refType,
      refId: opts.refId,
      outcome: outcomeOf(e),
      durationMs: Date.now() - startedAt,
    })
    console.warn('[generate] failed', e instanceof Error ? e.message : e)
    return null
  }
}

/** Черновик эталонного списка по запросу. null при ошибке/выкл. */
export async function generateListDraft(query: string, lang: Lang, opts: GenerateOptions = {}): Promise<GeneratedList | null> {
  const langName = langEnName(lang)
  const web = opts.web ?? true
  const variantHint =
    opts.variant && opts.variant > 1
      ? `\nThis is regeneration attempt #${opts.variant}: produce a MEANINGFULLY DIFFERENT take (different angle, ordering or scope) from a typical answer.`
      : ''
  const sp = spotlight()
  // Тип списка (ADR-0010): форма вывода — решение по запросу, а не константа. opts.kind даёт
  // вызывающему переопределить (переключатель типа в чате, Ф-Т2); иначе классифицируем сами.
  const kind = opts.kind ?? classifyListKind(query)
  // Закон типа списка (напр. рецепт: ингредиенты с развесовкой) — обязателен и здесь: одиночная
  // генерация идёт мимо совета, но форма от этого меняться не должна.
  const system = `You generate a canonical, high-quality, community-grade reference list as STRICT JSON.${lawBlock(query)}
All content MUST be in ${langName}.
${web ? 'Use up-to-date web search results to make the list accurate and current.\n' : ''}${jsonShapeFor(kind)}
- Be accurate and practical. Everything in ${langName}.${variantHint}${detailRule(opts.detail ?? DEFAULT_DETAIL)}
${sp.rule()}`
  const feature: AiFeature = opts.feature ?? (opts.variant && opts.variant > 1 ? 'regenerate' : 'generate')
  return runListModel(system, `Create the reference list for the topic below.\n${sp.wrap('TOPIC', query)}`, query, feature, { ...opts, web })
}

type NoteItem = { title: string; desc: string; command: string; subtasks: string[] }

/** Примечание к версии из диффа (как git-commit message). Возвращает одну строку или null. */
export async function generateChangeNote(
  base: NoteItem[],
  next: NoteItem[],
  lang: Lang,
  opts: GenerateOptions = {},
): Promise<string | null> {
  const client = await getAiChatClient()
  if (!client) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null // глобальный дневной кап расхода исчерпан

  const model = await pickChatModel(settings)
  const langName = langEnName(lang)
  const compact = (xs: NoteItem[]) =>
    xs.map((x, i) => `${i + 1}. ${x.title}${x.command ? ` [${x.command}]` : ''}`).join('\n').slice(0, MAX_PROMPT_CHARS)
  const sp = spotlight()

  const startedAt = Date.now()
  try {
    const result = await generateText({
      model: client.chat(model),
      system: `You write a SHORT changelog note (like a git commit message) describing what changed between two versions of a list, and why it matters. One concise line, imperative mood, in ${langName}. No quotes, no markdown, max ~90 characters.
${sp.rule()}`,
      prompt: `${sp.wrap('BEFORE', compact(base) || '(empty)')}\n\n${sp.wrap('AFTER', compact(next) || '(empty)')}\n\nWrite the change note.`,
      temperature: 0.3,
      maxOutputTokens: 60,
    })
    const u = extractUsage(result)
    await recordUsage({ userId: opts.userId, feature: 'note', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType, refId: opts.refId, outcome: 'ok', durationMs: Date.now() - startedAt })
    const note = result.text.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 140)
    return note || null
  } catch (e) {
    console.warn('[change-note] failed', e instanceof Error ? e.message : e)
    return null
  }
}

/** Перевод существующего списка на целевой язык (кнопка «Перевести», ADR-0009).
 *  Возвращает ТУ ЖЕ структуру (порядок/число шагов) на targetLang — вызывающий
 *  мёржит переводы в LocaleText, добавляя ключ (оригинал не трогается). URL
 *  ссылок НЕ переводим (label переводим, url оставляем). */
export async function generateListTranslation(
  current: { title: string; desc: string; items: GeneratedItem[] },
  targetLang: Lang,
  opts: GenerateOptions = {},
): Promise<GeneratedList | null> {
  const langName = langEnName(targetLang)
  const sp = spotlight()
  const system = `You TRANSLATE a list into ${langName}, returning the FULL list as STRICT JSON in EXACTLY the same shape and item order.
Translate every text field into ${langName}. Keep technical terms and commands (git, docker, npm, tool names) as commonly used by ${langName}-speaking developers.
Do NOT translate URLs (ref.url) — copy them verbatim; translate only ref.label.
Do NOT add, drop, reorder, merge or split items — one-to-one translation only.
${JSON_SHAPE}
${sp.rule()}`
  const prompt = `${sp.wrap('LIST TO TRANSLATE (JSON)', JSON.stringify(current).slice(0, MAX_PROMPT_CHARS))}

Translate the list above into ${langName} and return the full JSON list in the same shape and order.`
  return runListModel(system, prompt, current.title, 'translate', { ...opts, web: false })
}

/** Правка существующего списка по инструкции пользователя (AI-refine). */
export async function generateListRefine(
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] },
  instruction: string,
  lang: Lang,
  opts: GenerateOptions = {},
): Promise<GeneratedList | null> {
  const langName = langEnName(lang)
  const web = opts.web ?? false
  const sp = spotlight()
  const system = `You REFINE an existing list per the user's instruction, returning the FULL updated list as STRICT JSON.
All content MUST be in ${langName}.
Preserve good existing content and ordering; change only what the instruction requires. Do not drop unrelated steps.
${web ? 'You may use web search to ground new content.\n' : ''}${JSON_SHAPE}
- Everything in ${langName}.
${sp.rule()}`
  const prompt = `${sp.wrap('CURRENT LIST (JSON)', JSON.stringify(current).slice(0, MAX_PROMPT_CHARS))}

${sp.wrap('INSTRUCTION', instruction.slice(0, 2_000))}

Apply the instruction to the current list and return the full updated JSON list.`
  return runListModel(system, prompt, current.title, 'refine', { ...opts, web })
}
