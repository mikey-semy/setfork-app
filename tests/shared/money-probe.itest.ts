import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiUsage, db, generations, templates, users } from '@/shared/db'

// ВРЕМЕННЫЙ пробник контрольной проверки 2026-07-28 (реестр hq/reviews/2026-07-28-ledger.md).
// Проверяет ДЕНЕЖНЫЙ контур на реальной БД: месячная квота, глобальный дневной кап,
// квота на число списков, Free-лимит генераций, оценка цены RU-провайдеров.
// Удаляется после снятия доказательств — в репозиторий не коммитится.

let userId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${aiUsage}, ${generations}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'money-probe' }).returning({ id: users.id })
  userId = u.id
})

beforeEach(async () => {
  await db.delete(aiUsage)
  await db.delete(generations)
  await db.delete(templates)
})

/** Перечитать quota.ts с новым env (константы читаются на import-time). */
async function quotaWith(env: Record<string, string>) {
  Object.assign(process.env, env)
  vi.resetModules()
  return import('@/shared/quota')
}

const spend = async (usd: string, ageDays = 0) => {
  const [row] = await db
    .insert(aiUsage)
    .values({ userId, feature: 'generate', model: 'probe', costUsd: usd })
    .returning({ id: aiUsage.id })
  if (ageDays > 0)
    await db.execute(sql`update ${aiUsage} set created_at = now() - (${ageDays}::int * interval '1 day') where id = ${row.id}`)
}

describe('месячная квота AI-расхода (aiQuota)', () => {
  it('расход ниже потолка — квота открыта, выше — закрыта', async () => {
    const q = await quotaWith({ SETFORK_AI_MONTHLY_USD: '1', ADMIN_HANDLES: 'root' })
    await spend('0.400000')
    expect(await q.aiQuota(userId, 'money-probe')).toMatchObject({ ok: true, limit: 1 })
    await spend('0.400000')
    await spend('0.400000')
    const after = await q.aiQuota(userId, 'money-probe')
    expect(after.used).toBeCloseTo(1.2, 5)
    expect(after.ok).toBe(false)
  })

  it('расход прошлого месяца в текущую квоту не входит', async () => {
    const q = await quotaWith({ SETFORK_AI_MONTHLY_USD: '1', ADMIN_HANDLES: 'root' })
    await spend('5.000000', 40)
    const st = await q.aiQuota(userId, 'money-probe')
    expect(st.used).toBe(0)
    expect(st.ok).toBe(true)
  })

  it('админ (ADMIN_HANDLES) — без лимита даже при перерасходе', async () => {
    const q = await quotaWith({ SETFORK_AI_MONTHLY_USD: '1', ADMIN_HANDLES: 'money-probe' })
    await spend('99.000000')
    expect(await q.aiQuota(userId, 'money-probe')).toMatchObject({ ok: true, unlimited: true })
  })
})

describe('глобальный дневной кап (globalBudgetOk)', () => {
  it('дневной расход выше капа закрывает генерацию всему инстансу', async () => {
    const q = await quotaWith({ SETFORK_AI_DAILY_USD: '1', SETFORK_AI_BALANCE_FLOOR_USD: '0' })
    expect(await q.globalBudgetOk(1_000)).toBe(true)
    await spend('1.500000')
    // +31с — обход 30-секундного кэша
    expect(await q.globalBudgetOk(32_000)).toBe(false)
  })

  it('вчерашний расход сегодняшний кап не тратит', async () => {
    const q = await quotaWith({ SETFORK_AI_DAILY_USD: '1', SETFORK_AI_BALANCE_FLOOR_USD: '0' })
    await spend('5.000000', 1)
    expect(await q.globalBudgetOk(2_000_000)).toBe(true)
  })

  it('кап 0 = выключен сознательно: расход не блокирует', async () => {
    const q = await quotaWith({ SETFORK_AI_DAILY_USD: '0', SETFORK_AI_BALANCE_FLOOR_USD: '0' })
    await spend('999.000000')
    expect(await q.globalBudgetOk(3_000_000)).toBe(true)
  })

  it('мусор в env (не число) даёт БЕЗОПАСНЫЙ ли дефолт?', async () => {
    const q = await quotaWith({ SETFORK_AI_DAILY_USD: 'много', SETFORK_AI_BALANCE_FLOOR_USD: '0' })
    await spend('999.000000')
    // NaN > 0 → false → кап не применяется. Фиксируем ФАКТ, каким бы он ни был.
    const ok = await q.globalBudgetOk(4_000_000)
    console.log('[probe] мусор в SETFORK_AI_DAILY_USD → globalBudgetOk =', ok, '(true = кап молча выключен)')
    expect(typeof ok).toBe('boolean')
  })
})

describe('квота на число списков (listQuota)', () => {
  it('лимит достигнут — квота закрыта; админ без лимита', async () => {
    const q = await quotaWith({ SETFORK_MAX_LISTS_PER_USER: '2', ADMIN_HANDLES: 'root' })
    await db.insert(templates).values([
      { ownerId: userId, slug: 'a', title: { en: 'A' } },
      { ownerId: userId, slug: 'b', title: { en: 'B' } },
    ])
    expect(await q.listQuota(userId, 'money-probe')).toMatchObject({ used: 2, ok: false })
    expect(await q.listQuota(userId, 'root')).toMatchObject({ ok: true, unlimited: true })
  })
})

describe('Free-лимит генераций в месяц (freeGenQuota)', () => {
  it('limit<=0 — монетизация не активирована, лимита нет', async () => {
    const q = await quotaWith({})
    await db.insert(generations).values({ userId, query: 'x' })
    expect(await q.freeGenQuota(userId, 'money-probe', 0)).toMatchObject({ ok: true, unlimited: true })
  })

  it('limit=1 и одна генерация в этом месяце — закрыто; прошлый месяц не считается', async () => {
    const q = await quotaWith({})
    const [g] = await db.insert(generations).values({ userId, query: 'x' }).returning({ id: generations.id })
    expect(await q.freeGenQuota(userId, 'money-probe', 1)).toMatchObject({ used: 1, ok: false })
    await db.execute(sql`update ${generations} set created_at = now() - interval '40 days' where id = ${g.id}`)
    expect(await q.freeGenQuota(userId, 'money-probe', 1)).toMatchObject({ used: 0, ok: true })
  })
})

describe('единый прайс-слой: RU-провайдер без cost в ответе', () => {
  it('recordUsage оценивает стоимость сам (иначе денежные квоты слепы)', async () => {
    const { recordUsage } = await import('@/shared/ai/usage')
    await recordUsage({ userId, feature: 'generate', model: 'gpt://folder/yandexgpt/latest', input: 100_000, output: 20_000, total: 120_000, cost: 0, provider: 'yandex' })
    const [row] = await db.select({ cost: aiUsage.costUsd, model: aiUsage.model }).from(aiUsage)
    console.log('[probe] яндекс 120k токенов → cost_usd =', row?.cost)
    expect(Number(row?.cost)).toBeGreaterThan(0)
  })

  it('OpenRouter-строка без cost остаётся честным нулём, а не выдумкой', async () => {
    const { recordUsage } = await import('@/shared/ai/usage')
    await recordUsage({ userId, feature: 'generate', model: 'some/model', input: 1000, output: 500, total: 1500, cost: 0, provider: 'openrouter' })
    const [row] = await db.select({ cost: aiUsage.costUsd }).from(aiUsage)
    expect(Number(row?.cost)).toBe(0)
  })
})
