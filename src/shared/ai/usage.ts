import 'server-only'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { aiUsage, db, users } from '@/shared/db'
import type { AiProviderId } from '@/shared/settings/ai'

export type AiFeature = 'generate' | 'regenerate' | 'refine' | 'note' | 'moderate' | 'embed' | 'translate' | 'mcp-gnome' | 'dig' | 'assist' | 'gate'

// Форма usage-объекта OpenRouter (providerMetadata.openrouter.usage).
export interface OpenRouterUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cost?: number // в кредитах OpenRouter (= USD)
}

/** Достаёт usage/cost из результата generateText (OpenRouter usage accounting), с фолбэком на result.usage. */
export function extractUsage(result: {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  providerMetadata?: Record<string, unknown>
}): { input: number; output: number; total: number; cost: number } {
  const orRaw = (result.providerMetadata?.openrouter as { usage?: OpenRouterUsage } | undefined)?.usage
  const input = orRaw?.promptTokens ?? result.usage?.inputTokens ?? 0
  const output = orRaw?.completionTokens ?? result.usage?.outputTokens ?? 0
  const total = orRaw?.totalTokens ?? result.usage?.totalTokens ?? input + output
  const cost = typeof orRaw?.cost === 'number' ? orRaw.cost : 0
  return { input, output, total, cost }
}

/** Исход вызова ИИ: успех / таймаут / мусорный ответ (не-JSON) / ошибка сети-провайдера. */
export type AiOutcome = 'ok' | 'timeout' | 'invalid' | 'error'

/** Классификация пойманной ошибки вызова для журнала (таймаут отличаем от прочего). */
export function outcomeOf(e: unknown): AiOutcome {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /abort|timeout|timed out/i.test(msg) ? 'timeout' : 'error'
}

/** Записать один вызов ИИ в журнал расхода. Никогда не роняет основной поток. */
export async function recordUsage(row: {
  userId?: string | null
  feature: AiFeature
  model: string
  input: number
  output: number
  total: number
  cost: number
  refType?: string
  refId?: string
  outcome?: AiOutcome
  durationMs?: number
  /** Провайдер вызова — для оценки стоимости, когда API её не отдаёт. */
  provider?: AiProviderId
  /**
   * Кто расходовал: id специалиста в ростере. Отвечает на «сколько тратит ЭТОТ
   * мастер» отдельно от «как ведёт себя эта модель» — раньше оба вопроса сливались
   * в model id, и разделить вклад инструмента и исполнителя было нельзя.
   */
  gnomeId?: string
}): Promise<void> {
  try {
    // RU-провайдеры cost в ответе не присылают (писалось 0 → денежные квоты не
    // работали): оцениваем единым прайс-слоем (pricing: яндекс/гигачат — хардкод,
    // selectel — кеш их каталога). Без цены — честный 0, не выдумка.
    let cost = row.cost
    if (!cost) {
      const { estimateCostUsd } = await import('./pricing')
      cost = (await estimateCostUsd(row.provider, row.model, row.input, row.output)) ?? 0
    }
    await db.insert(aiUsage).values({
      userId: row.userId ?? null,
      feature: row.feature,
      model: row.model,
      inputTokens: Math.round(row.input),
      outputTokens: Math.round(row.output),
      totalTokens: Math.round(row.total),
      costUsd: cost.toFixed(6),
      refType: row.refType ?? null,
      refId: row.refId ?? null,
      outcome: row.outcome ?? 'ok',
      durationMs: Math.max(0, Math.round(row.durationMs ?? 0)),
      gnomeId: row.gnomeId ?? '',
    })
  } catch (e) {
    console.warn('[ai-usage] record failed', e instanceof Error ? e.message : e)
  }
}

export interface UsageByUser {
  userId: string | null
  handle: string | null
  name: string | null
  calls: number
  totalTokens: number
  costUsd: number
}

/** Агрегаты расхода по пользователям (для админки). sinceDays — окно, 0 = всё время. */
export async function getUsageByUser(sinceDays = 0): Promise<UsageByUser[]> {
  const filters = sinceDays > 0 ? [gte(aiUsage.createdAt, sql`now() - ${`${sinceDays} days`}::interval`)] : []
  const rows = await db
    .select({
      userId: aiUsage.userId,
      handle: users.handle,
      name: users.name,
      calls: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8`,
    })
    .from(aiUsage)
    .leftJoin(users, eq(aiUsage.userId, users.id))
    .where(filters.length ? and(...filters) : undefined)
    .groupBy(aiUsage.userId, users.handle, users.name)
    .orderBy(desc(sql`coalesce(sum(${aiUsage.costUsd}),0)`))
  return rows as UsageByUser[]
}

/** Итог по всему сервису за окно. */
export async function getUsageTotals(sinceDays = 0): Promise<{ calls: number; generations: number; totalTokens: number; costUsd: number }> {
  const filters = sinceDays > 0 ? [gte(aiUsage.createdAt, sql`now() - ${`${sinceDays} days`}::interval`)] : []
  const [r] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      // Генерация = один refId (совет = много вызовов на один refId). Считаем маркеры 'generation'/'council-run',
      // чтобы средняя цена была ЗА ГЕНЕРАЦИЮ, а не за вызов — так осязаемее «на сколько хватит остатка».
      generations: sql<number>`count(distinct ${aiUsage.refId}) filter (where ${aiUsage.refType} in ('generation','council-run'))::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8`,
    })
    .from(aiUsage)
    .where(filters.length ? and(...filters) : undefined)
  return r ?? { calls: 0, generations: 0, totalTokens: 0, costUsd: 0 }
}

/** Расход одного пользователя (для его настроек). */
export async function getUserUsage(userId: string): Promise<{ calls: number; totalTokens: number; costUsd: number }> {
  const [r] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8`,
    })
    .from(aiUsage)
    .where(eq(aiUsage.userId, userId))
  return r ?? { calls: 0, totalTokens: 0, costUsd: 0 }
}
