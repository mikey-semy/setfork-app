import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiUsage, db, templates, users } from '@/shared/db'
import { resetTables } from '../helpers/reset-db'

// Денежные предохранители при ИСПОРЧЕННОЙ настройке. До правки одна и та же опечатка в env
// давала противоположные тихие отказы: глобальный дневной кап расхода выключался совсем
// (деньги текли), а месячная квота закрывалась всем не-админам (ИИ переставал работать).
// Проверяем на реальной БД, что теперь оба случая падают в дефолт.

let userId = ''

beforeAll(async () => {
  await resetTables(sql`${aiUsage}, ${templates}, ${users}`)
  const [u] = await db.insert(users).values({ handle: 'quota-env' }).returning({ id: users.id })
  userId = u.id
})
beforeEach(async () => {
  await db.delete(aiUsage)
  await db.delete(templates)
})

/** Перечитать quota.ts с заданным env (константы читаются на import-time). */
async function quotaWith(env: Record<string, string>) {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  Object.assign(process.env, env)
  vi.resetModules()
  return import('@/shared/quota')
}
const spend = async (usd: string) => {
  await db.insert(aiUsage).values({ userId, feature: 'generate', model: 'probe', costUsd: usd })
}

describe('глобальный дневной кап при мусоре в env', () => {
  it('кап действует по дефолту, а не выключается молча', async () => {
    const q = await quotaWith({ SETFORK_AI_DAILY_USD: '10 usd', SETFORK_AI_BALANCE_FLOOR_USD: '0' })
    expect(q.AI_DAILY_USD).toBe(10)
    await spend('11.000000')
    expect(await q.globalBudgetOk(1_000)).toBe(false)
  })

  it('явный ноль по-прежнему выключает кап осознанно', async () => {
    const q = await quotaWith({ SETFORK_AI_DAILY_USD: '0', SETFORK_AI_BALANCE_FLOOR_USD: '0' })
    await spend('999.000000')
    expect(await q.globalBudgetOk(2_000_000)).toBe(true)
  })
})

describe('месячная квота и квота списков при мусоре в env', () => {
  it('месячная квота не закрывается всем: дефолт $5, расхода нет — можно работать', async () => {
    const q = await quotaWith({ SETFORK_AI_MONTHLY_USD: 'пять', ADMIN_HANDLES: 'root' })
    expect(q.AI_MONTHLY_USD).toBe(5)
    expect(await q.aiQuota(userId, 'quota-env')).toMatchObject({ used: 0, limit: 5, ok: true })
  })

  it('месячная квота всё так же закрывается по факту расхода', async () => {
    const q = await quotaWith({ SETFORK_AI_MONTHLY_USD: 'пять', ADMIN_HANDLES: 'root' })
    await spend('6.000000')
    expect((await q.aiQuota(userId, 'quota-env')).ok).toBe(false)
  })

  it('пустое значение лимита списков не блокирует создание (дефолт 200)', async () => {
    const q = await quotaWith({ SETFORK_MAX_LISTS_PER_USER: '', ADMIN_HANDLES: 'root' })
    expect(q.MAX_LISTS_PER_USER).toBe(200)
    expect(await q.listQuota(userId, 'quota-env')).toMatchObject({ used: 0, ok: true })
  })

  it('осмысленный лимит списков работает как прежде', async () => {
    const q = await quotaWith({ SETFORK_MAX_LISTS_PER_USER: '2', ADMIN_HANDLES: 'root' })
    await db.insert(templates).values([
      { ownerId: userId, slug: 'a', title: { en: 'A' } },
      { ownerId: userId, slug: 'b', title: { en: 'B' } },
    ])
    expect(await q.listQuota(userId, 'quota-env')).toMatchObject({ used: 2, ok: false })
  })
})
