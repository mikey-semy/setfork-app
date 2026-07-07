import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import { aiUsage, db, templates } from '@/shared/db'
import { isAdminHandle } from '@/shared/auth/admin'

// Квоты — мягкая защита от абьюза, не биллинг. Лимиты щедрые и настраиваются
// через env; администраторы без лимитов. Точки применения: создание списков
// (createTemplate/useTemplate/forkTemplate/acceptCandidate) и AI-расход
// (генерация/refine). Проверяем ПЕРЕД дорогой операцией.

export const MAX_LISTS_PER_USER = Number(process.env.SETFORK_MAX_LISTS_PER_USER ?? 200)
// Потолок AI-расхода на пользователя за календарный месяц (в USD ≈ кредиты OpenRouter).
export const AI_MONTHLY_USD = Number(process.env.SETFORK_AI_MONTHLY_USD ?? 5)
// Глобальный потолок AI-расхода на ВЕСЬ инстанс за календарные сутки (страховка от
// коллективного абьюза: N аккаунтов × месячная квота + фоновый расход). 0 = выкл.
export const AI_DAILY_USD = Number(process.env.SETFORK_AI_DAILY_USD ?? 0)

export interface QuotaState {
  used: number
  limit: number
  ok: boolean // есть ли ещё бюджет (used < limit)
  unlimited: boolean
}

/** Квота на количество списков во владении пользователя. */
export async function listQuota(userId: string, handle?: string | null): Promise<QuotaState> {
  if (isAdminHandle(handle)) return { used: 0, limit: Infinity, ok: true, unlimited: true }
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(templates).where(eq(templates.ownerId, userId))
  const used = r?.n ?? 0
  return { used, limit: MAX_LISTS_PER_USER, ok: used < MAX_LISTS_PER_USER, unlimited: false }
}

/** Месячная квота AI-расхода (сумма cost_usd за текущий календарный месяц). */
export async function aiQuota(userId: string, handle?: string | null): Promise<QuotaState> {
  if (isAdminHandle(handle)) return { used: 0, limit: Infinity, ok: true, unlimited: true }
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, sql`date_trunc('month', now())`)))
  const used = r?.usd ?? 0
  return { used, limit: AI_MONTHLY_USD, ok: used < AI_MONTHLY_USD, unlimited: false }
}

// Глобальный дневной бюджет кэшируем на 30с: проверяется на каждом дорогом AI-вызове,
// но суммировать ai_usage на каждый запрос незачем — расход меняется медленно.
let dailyBudgetCache: { ok: boolean; at: number } | null = null

/** Есть ли ещё глобальный дневной бюджет на весь инстанс. 0/выкл → всегда true.
 *  При исчерпании один раз пишет предупреждение в лог (алерт для оператора). */
export async function globalBudgetOk(now: number = Date.now()): Promise<boolean> {
  if (!(AI_DAILY_USD > 0)) return true
  if (dailyBudgetCache && now - dailyBudgetCache.at < 30_000) return dailyBudgetCache.ok
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, sql`date_trunc('day', now())`))
  const used = r?.usd ?? 0
  const ok = used < AI_DAILY_USD
  // Логируем только на переходе ok→не-ok, чтобы не спамить.
  if (!ok && (!dailyBudgetCache || dailyBudgetCache.ok))
    console.warn(`[ai-budget] глобальный дневной кап достигнут: $${used.toFixed(2)} ≥ $${AI_DAILY_USD} — новые AI-вызовы приостановлены`)
  dailyBudgetCache = { ok, at: now }
  return ok
}
