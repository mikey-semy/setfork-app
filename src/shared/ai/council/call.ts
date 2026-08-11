import 'server-only'
import { generateText } from 'ai'
import type { AiProviderId } from '@/shared/settings/ai'
import type { AiChatModel } from '../provider'
import { extractUsage, outcomeOf, recordUsage, type AiFeature } from '../usage'
import type { GenerateOptions } from '../generate'

// Потолок на ОДИН вызов: зависшая/медленная модель не должна вешать весь совет (6-7 вызовов).
// Превышение → вызов падает → гном «выпадает», совет продолжает без него.
// 120с, а не 60: живой бенч (research/2026-07-18-council-bench) показал 33% отказов — под
// одновременностью вызовы (особенно синтез старейшины на большой модели с длинным промптом) не
// укладывались в 60с. При успехе совет ~4 мин, отдельные вызовы 60-120с — 60с резал их зря.
const CALL_TIMEOUT_MS = 120_000

/** Транзиент — то, что имеет смысл повторить: таймаут, сеть, 429, 5xx. */
const TRANSIENT = /timeout|abort|econnreset|fetch failed|network|socket|429|50[234]/i

/** Модель иногда предваряет JSON прозой («Here is the list:») — берём тело объекта. */
export function firstJson(t: string): string {
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}

/** `:online` — механика веб-поиска OpenRouter; на других провайдерах суффикса нет. */
export const online = (m: string, web: boolean) => (web && m ? `${m}:online` : m)

/** Один под-вызов совета. null = гном «выпал», виток продолжается без него. */
export type CouncilRunner = (
  model: string,
  system: string,
  prompt: string,
  maxTokens?: number,
  temp?: number,
  /** КТО расходовал: роль гнома или служебный шаг (распорядитель, критик, старейшина). */
  gnomeId?: string,
) => Promise<{ text: string } | null>

/**
 * Единственная точка вызова модели в совете: таймаут, ОДИН ретрай транзиента и учёт
 * расхода. Всё, что вызову нужно знать про виток (клиент, провайдер, лимиты, кому
 * писать расход), берётся один раз здесь — иначе эти семь значений пришлось бы
 * таскать в каждый из семи вызовов.
 *
 * Ретрай именно транзиента бьёт по хвосту отказов, не удваивая цену на стабильных
 * ответах: бенч показал, что 33% отказов — упавшие под нагрузкой ОДИНОЧНЫЕ вызовы
 * (чаще синтез старейшины), а не детерминированный сбой.
 */
export function makeCouncilRunner(ctx: {
  chat: (model: string, opts?: { structured?: boolean; extraBody?: Record<string, unknown> }) => AiChatModel
  providerId: AiProviderId
  feature: AiFeature
  /** Значения по умолчанию из настроек ИИ — вызов может их переопределить. */
  maxTokens: number
  temperature: number
  opts: GenerateOptions
}): CouncilRunner {
  const { chat, providerId, feature, opts } = ctx
  const refType = opts.refType ?? 'council'

  return async function run(model, system, prompt, maxTokens = ctx.maxTokens, temp = ctx.temperature, gnomeId = '') {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = Date.now()
      try {
        const result = await generateText({
          model: chat(model),
          system,
          prompt,
          temperature: temp,
          maxOutputTokens: maxTokens,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        })
        const u = extractUsage(result)
        await recordUsage({ userId: opts.userId, feature, model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType, refId: opts.refId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: providerId, gnomeId })
        return { text: result.text }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Каждый ФИЗИЧЕСКИЙ вызов попадает в журнал (и ретраи) — иначе щиток
        // надёжности видел бы только успехи и карантин никогда бы не срабатывал.
        await recordUsage({ userId: opts.userId, feature, model, input: 0, output: 0, total: 0, cost: 0, refType, refId: opts.refId, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: providerId, gnomeId })
        if (attempt === 0 && TRANSIENT.test(msg)) {
          console.warn('[council] call retry', msg)
          continue
        }
        console.warn('[council] call failed', msg)
        return null
      }
    }
    return null
  }
}
