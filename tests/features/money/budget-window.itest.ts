import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Линза 03 (деньги), №2: решение «бюджет ЕСТЬ» кэшировалось на 30 секунд НАРАВНЕ с
// решением «бюджета нет». После пробития дневного капа система ещё до полуминуты
// пропускала любое число дорогих вызовов (прогон реестра: 200 из 200), а кэш ещё и
// процессный — у каждого воркера своё окно. Проверяем на реальной БД: у границы капа
// положительное решение больше не кэшируется.

const OLD_DAILY = process.env.SETFORK_AI_DAILY_USD
const OLD_FLOOR = process.env.SETFORK_AI_BALANCE_FLOOR_USD
process.env.SETFORK_AI_DAILY_USD = '10'
process.env.SETFORK_AI_BALANCE_FLOOR_USD = '0' // пол баланса выключен: проверяем дневной кап

const { db, aiUsage } = await import('@/shared/db')
const { globalBudgetOk, clearBudgetCache, AI_DAILY_USD } = await import('@/shared/quota')

/** Записать расход текущими сутками. */
async function spend(usd: number): Promise<void> {
  await db.insert(aiUsage).values({ feature: 'generate', model: 'test/model', costUsd: String(usd) })
}

beforeEach(async () => {
  await resetTables(sql`${aiUsage}`, { restartIdentity: false, cascade: false })
  clearBudgetCache()
})

afterAll(() => {
  if (OLD_DAILY === undefined) delete process.env.SETFORK_AI_DAILY_USD
  else process.env.SETFORK_AI_DAILY_USD = OLD_DAILY
  if (OLD_FLOOR === undefined) delete process.env.SETFORK_AI_BALANCE_FLOOR_USD
  else process.env.SETFORK_AI_BALANCE_FLOOR_USD = OLD_FLOOR
})

describe('окно пробитого дневного капа', () => {
  it('кап на месте: расход выше потолка закрывает генерацию', async () => {
    expect(AI_DAILY_USD).toBe(10)
    await spend(11)
    expect(await globalBudgetOk()).toBe(false)
  })

  it('у границы капа решение НЕ кэшируется: следующий вызов видит правду сразу', async () => {
    const t0 = 1_000_000
    await spend(9) // 90% капа — горячая зона
    expect(await globalBudgetOk(t0)).toBe(true)

    // Расход дотянул до потолка, времени прошло меньше секунды — прежний кэш ответил бы «можно».
    await spend(2)
    expect(await globalBudgetOk(t0 + 500)).toBe(false)
  })

  it('вдали от капа кэш работает (лишние агрегаты на каждый вызов не нужны)', async () => {
    const t0 = 2_000_000
    await spend(1) // 10% капа — холодно
    expect(await globalBudgetOk(t0)).toBe(true)
    await spend(20) // расход внутри окна кэша
    expect(await globalBudgetOk(t0 + 5_000)).toBe(true) // ещё пропускает — это осознанный компромисс
    expect(await globalBudgetOk(t0 + 31_000)).toBe(false) // окно истекло → правда
  })

  it('отрицательное решение кэшируется (лишний счёт при исчерпанном бюджете не нужен)', async () => {
    const t0 = 3_000_000
    await spend(50)
    expect(await globalBudgetOk(t0)).toBe(false)
    await resetTables(sql`${aiUsage}`, { restartIdentity: false, cascade: false })
    expect(await globalBudgetOk(t0 + 1_000)).toBe(false) // ещё в окне
    expect(await globalBudgetOk(t0 + 31_000)).toBe(true) // окно истекло → снова можно
  })
})
