import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { aiUsage, db, users } from '@/shared/db'

// ПРОБНИК линзы 03 (деньги), не для коммита: держат ли предохранители расхода.
//
// Проверяем на РЕАЛЬНОЙ БД, а не по коду: засеваем расход в ai_usage и спрашиваем
// те же функции, которые зовёт продукт. Модули импортируем динамически ВНУТРИ
// тестов — константы лимитов читаются из env на этапе импорта, и подменять их
// нужно до него.
//
// Прогон: DATABASE_URL=... npx vitest run --config vitest.integration.config.ts tests/features/money/quota-probe.itest.ts

const spend = async (userId: string | null, usd: number, daysAgo = 0) => {
  const [row] = await db
    .insert(aiUsage)
    .values({
      userId,
      feature: 'generate',
      model: 'probe/model',
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      costUsd: usd.toFixed(6),
      outcome: 'ok',
    })
    .returning({ id: aiUsage.id })
  if (daysAgo) {
    await db.execute(sql`update ${aiUsage} set created_at = now() - (${daysAgo}::int * interval '1 day') where id = ${row.id}`)
  }
}

const newUser = async (prefix: string) => {
  const [u] = await db
    .insert(users)
    .values({ handle: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}` })
    .returning({ id: users.id, handle: users.handle })
  return u
}

beforeEach(async () => {
  await db.delete(aiUsage)
  // Кэш глобального бюджета живёт 30с внутри модуля — сбрасываем импорт-кэш,
  // иначе второй тест увидит решение первого.
  vi.resetModules()
})

describe('предохранители расхода', () => {
  it('месячная квота пользователя закрывается по факту расхода', async () => {
    process.env.SETFORK_AI_MONTHLY_USD = '1'
    const { aiQuota } = await import('@/shared/quota')
    const u = await newUser('quota')

    const before = await aiQuota(u.id, u.handle)
    expect(before.ok, 'на старте бюджет есть').toBe(true)

    await spend(u.id, 0.6)
    const mid = await aiQuota(u.id, u.handle)
    console.log('ПОСЛЕ $0.60:', mid)
    expect(mid.ok).toBe(true)

    await spend(u.id, 0.5)
    const after = await aiQuota(u.id, u.handle)
    console.log('ПОСЛЕ $1.10:', after)
    expect(after.ok, 'квота обязана закрыться при превышении').toBe(false)
  })

  it('расход ПРОШЛОГО месяца не съедает текущую квоту', async () => {
    process.env.SETFORK_AI_MONTHLY_USD = '1'
    const { aiQuota } = await import('@/shared/quota')
    const u = await newUser('oldmonth')
    await spend(u.id, 5, 40) // 40 дней назад
    const q = await aiQuota(u.id, u.handle)
    console.log('СТАРЫЙ РАСХОД $5 (40 дней назад):', q)
    expect(q.ok, 'месячная квота считает только текущий месяц').toBe(true)
  })

  it('чужой расход не закрывает мою квоту', async () => {
    process.env.SETFORK_AI_MONTHLY_USD = '1'
    const { aiQuota } = await import('@/shared/quota')
    const me = await newUser('me')
    const other = await newUser('other')
    await spend(other.id, 10)
    const q = await aiQuota(me.id, me.handle)
    console.log('ЧУЖОЙ РАСХОД $10:', q)
    expect(q.ok).toBe(true)
  })

  it('глобальный дневной кап закрывается суммой ВСЕХ пользователей', async () => {
    process.env.SETFORK_AI_DAILY_USD = '1'
    process.env.SETFORK_AI_BALANCE_FLOOR_USD = '0' // пол баланса выключаем: тут проверяем кап
    const { globalBudgetOk } = await import('@/shared/quota')
    const a = await newUser('ga')
    const b = await newUser('gb')

    expect(await globalBudgetOk(1), 'на старте бюджет есть').toBe(true)
    await spend(a.id, 0.7)
    await spend(b.id, 0.5)
    // now сдвигаем за пределы 30-секундного кэша, иначе увидим прошлое решение.
    const ok = await globalBudgetOk(1 + 60_000)
    console.log('ГЛОБАЛЬНЫЙ КАП после $1.20 при лимите $1:', ok)
    expect(ok, 'дневной кап обязан закрыться').toBe(false)
  })

  it('расход БЕЗ userId (фон, гномы) тоже считается в глобальном капе', async () => {
    process.env.SETFORK_AI_DAILY_USD = '1'
    process.env.SETFORK_AI_BALANCE_FLOOR_USD = '0'
    const { globalBudgetOk } = await import('@/shared/quota')
    await spend(null, 2) // системный расход, пользователя нет
    const ok = await globalBudgetOk(2 + 60_000)
    console.log('ГЛОБАЛЬНЫЙ КАП при системном расходе $2:', ok)
    expect(ok, 'фоновый расход обязан учитываться в глобальном капе').toBe(false)
  })

  it('вчерашний расход не блокирует сегодня', async () => {
    process.env.SETFORK_AI_DAILY_USD = '1'
    process.env.SETFORK_AI_BALANCE_FLOOR_USD = '0'
    const { globalBudgetOk } = await import('@/shared/quota')
    await spend(null, 5, 1)
    const ok = await globalBudgetOk(3 + 60_000)
    console.log('ВЧЕРАШНИЙ РАСХОД $5:', ok)
    expect(ok, 'дневной кап считает только сегодня').toBe(true)
  })

  it('мусор в настройке лимита не выключает предохранитель молча', async () => {
    for (const junk of ['abc', '', '-5', 'NaN']) {
      vi.resetModules()
      process.env.SETFORK_AI_DAILY_USD = junk
      const { AI_DAILY_USD } = await import('@/shared/quota')
      console.log(`SETFORK_AI_DAILY_USD=${JSON.stringify(junk)} →`, AI_DAILY_USD)
      expect(Number.isFinite(AI_DAILY_USD), `мусор ${JSON.stringify(junk)} дал не число`).toBe(true)
      expect(AI_DAILY_USD, `мусор ${JSON.stringify(junk)} не должен выключать кап`).toBeGreaterThan(0)
    }
  })
})

describe('окно, в котором кап уже пробит, но ещё пропускает', () => {
  it('после исчерпания капа решение держится кэшем 30 секунд', async () => {
    process.env.SETFORK_AI_DAILY_USD = '1'
    process.env.SETFORK_AI_BALANCE_FLOOR_USD = '0'
    vi.resetModules()
    const { globalBudgetOk } = await import('@/shared/quota')

    const t0 = 1_000_000
    expect(await globalBudgetOk(t0), 'старт: бюджет есть').toBe(true)

    // Кап пробит сразу после первой проверки.
    await spend(null, 5)

    const срезы = [0, 5_000, 15_000, 29_000, 31_000].map((dt) => dt)
    const ответы: Record<number, boolean> = {}
    for (const dt of срезы) ответы[dt] = await globalBudgetOk(t0 + dt)
    console.log('РЕШЕНИЕ КАПА ПО ВРЕМЕНИ (мс → пропускать?):', ответы)

    expect(ответы[29_000], 'внутри окна кэша кап продолжает пропускать').toBe(true)
    expect(ответы[31_000], 'после окна кэша кап закрывается').toBe(false)
  })

  it('сколько вызовов успевает пройти в это окно (при concurrency)', async () => {
    process.env.SETFORK_AI_DAILY_USD = '1'
    process.env.SETFORK_AI_BALANCE_FLOOR_USD = '0'
    vi.resetModules()
    const { globalBudgetOk } = await import('@/shared/quota')
    const t0 = 2_000_000
    await globalBudgetOk(t0)
    await spend(null, 5) // кап пробит

    let пропущено = 0
    for (let i = 0; i < 200; i++) if (await globalBudgetOk(t0 + 10_000)) пропущено++
    console.log(`ВНУТРИ ОКНА пропущено ${пропущено} из 200 проверок бюджета`)
    expect(пропущено).toBe(200)
  })
})
