import 'server-only'
import { generateText } from 'ai'
import { getAiSettings } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { getAiChatClient } from './provider'
import { pickChatModels } from './credits'
import { extractUsage, outcomeOf, recordUsage, type AiFeature } from './usage'
import { retryPlan } from './retry'
import type { AiFailure } from './failure'
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
  /** Заголовок группы-секции (напр. рецепт: «Ингредиенты»/«Приготовление»). '' — без секции. */
  section?: string
  level: 'required' | 'recommended' | 'optional'
  why: string
  subtasks: string[]
  refs: GeneratedRef[]
  /** «Здесь нужен человек» — модель сама признаёт, что знать этого не может. */
  needsHuman?: boolean
  /** Что именно спросить у человека (коротко, на языке списка). */
  needsHumanAsk?: string
}
export interface GeneratedList {
  title: string
  desc: string
  tags: string[]
  items: GeneratedItem[]
  /** Подсказка «что улучшить следующим» ПО ТЕМЕ списка — плейсхолдер-призрак поля
   *  ввода в чате (фидбек владельца: генерированный текст, не статичная фраза).
   *  Модель отдаёт её в том же JSON — ноль дополнительных вызовов. */
  hint?: string
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
  /**
   * Куда сообщить, ПОЧЕМУ списка не будет. Возврат null сам по себе ничего не объясняет:
   * причина оставалась в логах воркера, а человек в чате видел глухое «не получилось».
   * Зовётся перед каждым «сдаюсь»; последний вызов и есть причина витка.
   */
  onFail?: (f: AiFailure) => void
}

/**
 * Форма JSON, ЗАВИСЯЩАЯ ОТ ТИПА СПИСКА (ADR-0010). Структура одна (CandidateItem переиспользуется),
 * меняется смысл элемента — блок shapeFor(kind). Раньше форма была захардкожена как процедура, и
 * запрос про «список вещей» приходил процедурой. По умолчанию kind='procedure' — прежнее поведение.
 */
export function jsonShapeFor(kind: ListKind = 'procedure'): string {
  return `Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "hint": string, "items": [{"title": string, "desc": string, "command": string, "section": string, "level": "required"|"recommended"|"optional", "why": string, "subtasks": string[], "refs": [{"label": string, "url": string}], "needsHuman": boolean, "needsHumanAsk": string}]}
Rules:
- title: concise noun phrase naming the list.
- desc: one sentence describing it.
- tags: 3-6 short lowercase tags, no '#'.
- hint: ONE short follow-up request (max 7 words, imperative, same language as the list) the user could send next to improve THIS list — specific to its topic, e.g. for a recipe "пересчитай на 4 порции". No quotes.
- refs: put ALL URLs here (never in command). Each ref: label = short human name, url = full https URL. Use [] when there is no good link.
- command: ONLY a REAL, runnable shell/CLI command (git, docker, npm, psql…). If the step is not technical — cooking, everyday life, physical actions, reading, decisions — leave it "". NEVER turn prose into a fake command (e.g. "boil water", "buy milk", "call the vendor").
- section: a group heading for the item; "" unless the list type below asks to split items into groups.
- needsHuman: true when the step depends on something you CANNOT know — local prices and availability, taste and feel, how long it takes on THEIR equipment, regional rules, personal circumstances. Then needsHumanAsk = one short question a person could answer from real experience (max 10 words, same language as the list), and do NOT invent a plausible number instead. false + "" otherwise. Marking honestly is BETTER than filling the gap with an invented specific — a real person will answer it later.
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
          // section раньше ЗДЕСЬ терялся (докстрока GeneratedItem лгала) — из-за
          // этого рецепты приходили плоскими, а садовник исключал секционные списки.
          section: String(it?.section ?? '').trim().slice(0, 80),
          level: (LEVELS.includes(String(it?.level)) ? String(it?.level) : 'required') as GeneratedItem['level'],
          why: String(it?.why ?? '').trim(),
          needsHuman: it?.needsHuman === true,
          needsHumanAsk: String(it?.needsHumanAsk ?? '').trim().slice(0, 160),
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
    // Подсказка-призрак: без кавычек (модель любит их добавлять), коротко. Пусто — ок,
    // чат падает на статичный refineHint по типу.
    hint: String(obj.hint ?? '').trim().replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 80) || undefined,
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
  if (!client) {
    opts.onFail?.({ code: 'no_client' })
    return null
  }
  const settings = await getAiSettings()
  if (!settings.enabled) {
    opts.onFail?.({ code: 'ai_off' })
    return null
  }
  if (!(await globalBudgetOk())) {
    opts.onFail?.({ code: 'budget' }) // глобальный дневной кап расхода исчерпан
    return null
  }

  // :online-суффикс, models-фолбэк и middle-out — механики OpenRouter; на других
  // провайдерах зовём голую модель (веб-поиска и авто-фолбэка там нет).
  const isOpenRouter = client.cfg.provider === 'openrouter'
  const web = (opts.web ?? false) && isOpenRouter
  // Пара «основная + запасная» из ОДНОГО провайдера: при уходе на запасного настройки
  // основного больше не годятся, и запасная модель из его неймспейса была бы чужим id.
  const { base, fallback } = await pickChatModels(settings)
  const online = (m: string) => (web && m ? `${m}:online` : m)
  const models = [base, fallback].filter((v, i, a) => v && a.indexOf(v) === i).map(online)

  /**
   * КАНДИДАТЫ, а не одна модель. Раньше упавший вызов просто возвращал null: реакция на отказ
   * измерялась часами (пока карантин не наберёт статистику), хотя запасная модель была назначена
   * рядом. Теперь порядок такой же, как у LiteLLM: транзиентный отказ — повтор той же модели,
   * отказ самой модели (снята, не влезли в контекст) — переход к следующей, отказ по ключу или
   * деньгам — остановка, потому что другая модель не поможет.
   *
   * Причина наверх (opts.onFail) сообщается ОДИН раз и только окончательная: промежуточные
   * попытки — наша кухня, пользователю важно, чем всё кончилось.
   */
  const candidates = [base, fallback].filter((v, i, a) => v && a.indexOf(v) === i)
  let lastFailure: AiFailure | null = null

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = Date.now()
      try {
        const result = await generateText({
          model: client.chat(online(candidate), isOpenRouter ? { extraBody: { models, transforms: ['middle-out'] } } : undefined),
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
          // Модель ИЗ ОТВЕТА, а не запрошенная: при фолбэке на стороне OpenRouter (extraBody.models)
          // отвечает другая, и журнал приписывал цену и отказы невиновной — вместе с карантином,
          // который на этом журнале и строится (аудит 2026-08-01). ':online' сохраняем: у него своя
          // флэт-надбавка, и без суффикса 60% расхода были не видны в админке.
          model: servedModel(result, online(candidate), web),
          input: u.input,
          output: u.output,
          total: u.total,
          cost: u.cost,
          refType: opts.refType,
          refId: opts.refId,
          outcome: parsed ? 'ok' : 'invalid',
          durationMs: Date.now() - startedAt,
          provider: client.cfg.provider,
        })
        if (parsed) return parsed
        // Ответ пришёл, но списком не оказался. Голова ответа — в причину: по ней видно, что
        // именно пришло (пустой текст, извинение модели, обрезанный JSON). Пробуем следующего
        // кандидата: другая модель на том же промпте часто отвечает разбираемо.
        lastFailure = { code: 'invalid', model: online(candidate), detail: result.text.slice(0, 400) }
        break
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        await recordUsage({
          userId: opts.userId,
          feature,
          model: online(candidate),
          input: 0,
          output: 0,
          total: 0,
          cost: 0,
          refType: opts.refType,
          refId: opts.refId,
          outcome: outcomeOf(e),
          durationMs: Date.now() - startedAt,
          provider: client.cfg.provider,
        })
        const plan = retryPlan(e)
        lastFailure = { code: outcomeOf(e) === 'timeout' ? 'timeout' : 'error', model: online(candidate), detail: msg }
        console.warn(`[generate] ${candidate} упала (${plan}):`, e instanceof Error ? e.message : e)
        if (plan === 'stop') {
          opts.onFail?.(lastFailure)
          return null
        }
        if (plan === 'other') break // к следующему кандидату
        // 'same' — второй заход той же моделью, дальше уходим к следующей
      }
    }
  }
  if (lastFailure) opts.onFail?.(lastFailure)
  return null
}

/** Кто РЕАЛЬНО ответил: id из ответа провайдера, если он его назвал. */
function servedModel(result: { response?: { modelId?: string } }, requested: string, web: boolean): string {
  const served = result.response?.modelId
  if (!served || served === requested) return requested
  // Веб-надбавка привязана к вызову, а не к модели: суффикс переносим на реально ответившую.
  return web ? `${served}:online` : served
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

  const { base: model } = await pickChatModels(settings)
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
    await recordUsage({ userId: opts.userId, feature: 'note', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType, refId: opts.refId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: client.cfg.provider })
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

/** Правка существующего списка по инструкции пользователя (AI-refine).
 *  opts.kind задаёт форму JSON по типу списка (рецепт хранит секции и т.д.) —
 *  раньше форма всегда была procedure, и refine рецепта ломал его структуру. */
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
Translation is never an improvement: if the CURRENT LIST is written in a different language than ${langName}, keep the language of the CURRENT LIST — unless the INSTRUCTION explicitly asks to translate.
Preserve good existing content and ordering; change only what the instruction requires. Do not drop unrelated steps.
Preserve each item's "section" value; keep items grouped in their sections.
Preserve each item's "needsHuman" and "needsHumanAsk" as they are — they mark where a real person's
experience is required (local prices, taste, timing on their equipment). Removing an honest mark is
worse than leaving it: only drop it when your edit actually ANSWERS the question. You may add a new
mark where the current text states something you cannot know.
${web ? 'You may use web search to ground new content.\n' : ''}${jsonShapeFor(opts.kind ?? 'procedure')}
- Everything in ${langName}.
${sp.rule()}`
  const prompt = `${sp.wrap('CURRENT LIST (JSON)', JSON.stringify(current).slice(0, MAX_PROMPT_CHARS))}

${sp.wrap('INSTRUCTION', instruction.slice(0, 2_000))}

Apply the instruction to the current list and return the full updated JSON list.`
  return runListModel(system, prompt, current.title, 'refine', { ...opts, web })
}
