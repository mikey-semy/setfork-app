import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import { aiUsage, db, templates } from '@/shared/db'
import { isAdminHandle } from '@/shared/auth/admin'
import { getOpenRouterCredits } from '@/shared/ai/credits'

// Квоты — мягкая защита от абьюза, не биллинг. Лимиты щедрые и настраиваются
// через env; администраторы без лимитов. Точки применения: создание списков
// (createTemplate/useTemplate/forkTemplate/acceptCandidate) и AI-расход
// (генерация/refine). Проверяем ПЕРЕД дорогой операцией.

export const MAX_LISTS_PER_USER = Number(process.env.SETFORK_MAX_LISTS_PER_USER ?? 200)
// Потолок AI-расхода на пользователя за календарный месяц (в USD ≈ кредиты OpenRouter).
export const AI_MONTHLY_USD = Number(process.env.SETFORK_AI_MONTHLY_USD ?? 5)
// Глобальный потолок AI-расхода на ВЕСЬ инстанс за календарные сутки (страховка от runaway: бага
// или коллективный абьюз). ВКЛЮЧЁН по умолчанию ($10/день): при нашей юнит-цене (совет $0.0026,
// одиночная $0.0013) это с запасом покрывает 100+ активных/день, но останавливает утечку бюджета.
// 0 = выкл (сознательно). Раньше дефолт был 0 — глобального капа не было вообще.
export const AI_DAILY_USD = Number(process.env.SETFORK_AI_DAILY_USD ?? 10)
// Пол живого остатка на счёте OpenRouter. Ниже — стоп-генерация: при $0 система раньше просто
// продолжала звать и получать ошибки. 0 = выкл. Best-effort: сбой credits-эндпоинта не блокирует
// (полагаемся на дневной кап), иначе флейк статуса провайдера ронял бы весь продукт.
export const AI_BALANCE_FLOOR_USD = Number(process.env.SETFORK_AI_BALANCE_FLOOR_USD ?? 0.5)

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

/**
 * Есть ли ещё глобальный бюджет на весь инстанс — ДВА независимых предохранителя:
 *  1) дневной кап расхода по нашему ai_usage (надёжный, считаем сами);
 *  2) пол живого остатка на счёте OpenRouter (реальность важнее нашего учёта: он может отставать).
 * Оба кэшируются на 30с. При исчерпании один раз пишем предупреждение — алерт оператору.
 */
export async function globalBudgetOk(now: number = Date.now()): Promise<boolean> {
  if (dailyBudgetCache && now - dailyBudgetCache.at < 30_000) return dailyBudgetCache.ok

  // 1) Дневной кап по нашему учёту.
  let ok = true
  let reason = ''
  if (AI_DAILY_USD > 0) {
    const [r] = await db
      .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, sql`date_trunc('day', now())`))
    const used = r?.usd ?? 0
    if (used >= AI_DAILY_USD) {
      ok = false
      reason = `дневной кап: $${used.toFixed(2)} ≥ $${AI_DAILY_USD}`
    }
  }

  // 2) Пол живого баланса OpenRouter. Best-effort: credits === null (сбой эндпоинта) НЕ блокирует —
  //    полагаемся на дневной кап, иначе флейк статуса провайдера остановил бы весь продукт.
  if (ok && AI_BALANCE_FLOOR_USD > 0) {
    const credits = await getOpenRouterCredits()
    if (credits && credits.remaining < AI_BALANCE_FLOOR_USD) {
      ok = false
      reason = `остаток OpenRouter $${credits.remaining.toFixed(2)} < пол $${AI_BALANCE_FLOOR_USD}`
    }
  }

  if (!ok && (!dailyBudgetCache || dailyBudgetCache.ok))
    console.warn(`[ai-budget] генерация приостановлена — ${reason}`)
  dailyBudgetCache = { ok, at: now }
  return ok
}
