import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, stars, templates, templateVersions, users } from '@/shared/db'
import { curationStore } from '@/features/curation/store'

// ПРОБНИК контрольной проверки (не для коммита): сходятся ли денормализованные
// счётчики списка с фактом.
//
// Различаем два вида счётчиков. От СОБЫТИЯ (просмотры, прогоны) — монотонные, они
// ничему равняться не обязаны. От СОСТОЯНИЯ (stars_count = число строк в stars,
// forks_count = число форков) — обязаны сходиться, иначе публичная метрика врёт:
// по ним строится выдача каталога, бейджи и лендинг.
//
// Прогон: DATABASE_URL=... npx vitest run --config vitest.integration.config.ts tests/features/curation/counters-probe.itest.ts

let ownerId = ''
let fanId = ''

const newList = async (slug: string, over: Partial<typeof templates.$inferInsert> = {}) => {
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'v1' })
  return t.id
}

const counters = async (id: string) => {
  const [t] = await db
    .select({ stars: templates.starsCount, forks: templates.forksCount })
    .from(templates)
    .where(eq(templates.id, id))
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stars)
    .where(eq(stars.templateId, id))
  const [{ f }] = await db
    .select({ f: sql<number>`count(*)::int` })
    .from(templates)
    .where(eq(templates.forkedFromId, id))
  return { starsCount: t.stars, starsRows: n, forksCount: t.forks, forkRows: f }
}

beforeAll(async () => {
  const [o] = await db
    .insert(users)
    .values({ handle: `probe-owner-${Date.now()}` })
    .returning({ id: users.id })
  const [f] = await db
    .insert(users)
    .values({ handle: `probe-fan-${Date.now()}` })
    .returning({ id: users.id })
  ownerId = o.id
  fanId = f.id
})

describe('счётчики списка против факта', () => {
  it('одиночный тоггл звезды: счётчик идёт за фактом', async () => {
    const id = await newList(`solo-${Date.now()}`)
    await curationStore.toggleStar(id, fanId)
    expect(await counters(id)).toMatchObject({ starsCount: 1, starsRows: 1 })
    await curationStore.toggleStar(id, fanId)
    expect(await counters(id)).toMatchObject({ starsCount: 0, starsRows: 0 })
  })

  it('ПАРАЛЛЕЛЬНЫЕ нажатия одного пользователя не должны накручивать счётчик', async () => {
    const id = await newList(`race-${Date.now()}`)
    // Шесть одновременных «кликов» — двойной клик, повтор запроса, скрипт.
    await Promise.allSettled(Array.from({ length: 6 }, () => curationStore.toggleStar(id, fanId)))
    const c = await counters(id)
    console.log('ПАРАЛЛЕЛЬНЫЕ ЗВЁЗДЫ:', c)
    expect(c.starsCount, `счётчик разъехался с фактом: ${JSON.stringify(c)}`).toBe(c.starsRows)
  })

  it('удаление форка возвращает forks_count к факту', async () => {
    const parent = await newList(`parent-${Date.now()}`)
    const fork = await newList(`fork-${Date.now()}`, { forkedFromId: parent, origin: 'forked' })
    // Форк засчитан так же, как это делает действие форка.
    await db
      .update(templates)
      .set({ forksCount: sql`${templates.forksCount} + 1` })
      .where(eq(templates.id, parent))
    expect(await counters(parent)).toMatchObject({ forksCount: 1, forkRows: 1 })

    // Автор форка удаляет свой список — ровно как deleteListAction.
    await db.delete(templates).where(eq(templates.id, fork))
    const after = await counters(parent)
    console.log('ПОСЛЕ УДАЛЕНИЯ ФОРКА:', after)
    expect(after.forksCount, `счётчик форков врёт: ${JSON.stringify(after)}`).toBe(after.forkRows)
  })

  it('удаление РОДИТЕЛЯ не уносит чужой форк', async () => {
    const parent = await newList(`p2-${Date.now()}`)
    const fork = await newList(`f2-${Date.now()}`, { forkedFromId: parent, origin: 'forked' })
    await db.delete(templates).where(eq(templates.id, parent))
    const [alive] = await db.select({ id: templates.id, from: templates.forkedFromId }).from(templates).where(eq(templates.id, fork))
    console.log('ФОРК ПОСЛЕ УДАЛЕНИЯ РОДИТЕЛЯ:', alive)
    expect(alive, 'форк пользователя не должен исчезать вместе с родителем').toBeTruthy()
  })

  it('снятая звезда исчезает вместе с пользователем и счётчик это переживает', async () => {
    const id = await newList(`gone-${Date.now()}`)
    const [tmp] = await db
      .insert(users)
      .values({ handle: `probe-gone-${Date.now()}` })
      .returning({ id: users.id })
    await curationStore.toggleStar(id, tmp.id)
    expect(await counters(id)).toMatchObject({ starsCount: 1, starsRows: 1 })
    await db.delete(users).where(eq(users.id, tmp.id)) // каскад уносит строку stars
    const after = await counters(id)
    console.log('ПОСЛЕ УДАЛЕНИЯ ПОЛЬЗОВАТЕЛЯ:', after)
    expect(after.starsCount, `счётчик пережил владельца звезды: ${JSON.stringify(after)}`).toBe(after.starsRows)
  })
})
