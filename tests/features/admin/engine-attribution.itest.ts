import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * КОМУ ЗАСЧИТАНА ГЕНЕРАЦИЯ: совету или одиночке.
 *
 * По этой цифре решают, стоит ли мультиагентный путь своих денег (разовый разбор
 * дал совет 12 → 0 принятых против одиночки 13 → 4). Значит ошибаться она не имеет
 * права ни в одну сторону.
 *
 * Раньше движок определялся по репликам прогресса `kind='draft'`, а они пишутся
 * ПЕРЕД вызовом эксперта: совет падал, результат доставляла одиночная генерация — и
 * приёмка всё равно приписывалась совету. Теперь считаем по сохранённым черновикам
 * доставленного витка: это факт о результате, а не о намерении.
 */
const { db, generationDrafts, generationMessages, generations, templates, users } = await import('@/shared/db')
const { getDevelopmentMetrics } = await import('@/features/admin/development-queries')

let userId = ''

const newGeneration = async (over: Record<string, unknown> = {}) => {
  const [g] = await db.insert(generations).values({ userId, query: 'борщ', lang: 'ru', ...over }).returning({ id: generations.id })
  return g.id
}

const engines = async () => (await getDevelopmentMetrics()).engines

beforeEach(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'eng-owner' }).returning({ id: users.id })
  userId = u.id
})

describe('атрибуция движка', () => {
  it('совет начался, но результат доставила одиночка → это НЕ совет', async () => {
    const gid = await newGeneration()
    // Реплики прогресса совета есть: он стартовал и упал.
    await db.insert(generationMessages).values([
      { generationId: gid, attempt: 1, kind: 'draft', who: 'chef', text: 'набросок' },
      { generationId: gid, attempt: 1, kind: 'draft', who: 'critic', text: 'разбор' },
    ])
    // А сохранённых черновиков нет — доставила одиночная генерация.
    const e = await engines()
    expect(e.single.gens).toBe(1)
    expect(e.council.gens).toBe(0)
  })

  it('черновики доставленного витка есть → это совет', async () => {
    const gid = await newGeneration({ chosenIdx: 1 })
    await db.insert(generationDrafts).values([
      { generationId: gid, idx: 1, letter: 'A', who: 'chef', text: 'а' },
      { generationId: gid, idx: 1, letter: 'B', who: 'critic', text: 'б' },
    ])
    const e = await engines()
    expect(e.council.gens).toBe(1)
    expect(e.single.gens).toBe(0)
  })

  it('черновики от ДРУГОГО витка не делают принятый виток советом', async () => {
    // Первый виток шёл советом, второй (принятый) — одиночкой после смены настроек.
    const gid = await newGeneration({ chosenIdx: 2 })
    await db.insert(generationDrafts).values([{ generationId: gid, idx: 1, letter: 'A', who: 'chef', text: 'а' }])
    const e = await engines()
    expect(e.single.gens, 'принятый виток был одиночным — совет его себе не забирает').toBe(1)
    expect(e.council.gens).toBe(0)
  })
})
