import { expect, it } from 'vitest'
import { db, aiUsage, templates, users } from '@/shared/db'
import { resetTables } from './reset-db'

/**
 * Очистка обязана уносить и то, что ссылается на названные таблицы.
 *
 * `TRUNCATE … CASCADE` делал это сам; `DELETE` — нет: при `ON DELETE SET NULL`
 * (в схеме таких связей 29) строка остаётся, у неё лишь обнуляется ключ. Для
 * `ai_usage.user_id` это значит, что расход пережил бы автора и лёг «системным»
 * в дневной кап следующего теста — `shared/quota.ts` суммирует таблицу целиком.
 * Находка авто-ревью на fe#747; тест держит замыкание зависимостей на месте.
 */
it('очистка уносит строки за ON DELETE SET NULL', async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'reset-probe' }).returning({ id: users.id })
  await db.insert(aiUsage).values({ userId: u.id, feature: 'generate', model: 'probe', costUsd: '1.5' })

  await resetTables([templates, users])

  const left = await db.select().from(aiUsage)
  expect(left.length, 'ai_usage пережил очистку users — замыкание зависимостей потерялось').toBe(0)
})
