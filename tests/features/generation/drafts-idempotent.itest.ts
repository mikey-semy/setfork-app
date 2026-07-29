import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Черновики совета пишутся ЗАМЕНОЙ, а не досыпкой.
 *
 * Обычная вставка задваивала строки при каждом повторе попытки: воркер перезапустил
 * задачу или две задачи разошлись на одном (generationId, idx) — и к прежнему набору
 * A/B/C добавлялся ещё один. Замер многогранности группирует строки одного витка и
 * считает КАЖДУЮ, поэтому дубли завышали вклад и приписывали его не тем граням.
 *
 * Проверяем на живой БД: дубли — это про то, что реально лежит в таблице, а не про
 * логику в памяти.
 */
const { db, generationDrafts, generations, users } = await import('@/shared/db')

let userId = ''
let generationId = ''

/** Та же запись, что делает сервис после доставки кандидата. */
async function saveDrafts(idx: number, letters: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(generationDrafts).where(and(eq(generationDrafts.generationId, generationId), eq(generationDrafts.idx, idx)))
    await tx.insert(generationDrafts).values(letters.map((l) => ({ generationId, idx, letter: l, who: 'expert', text: `черновик ${l}` })))
  })
}

const countFor = async (idx: number) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(generationDrafts)
    .where(and(eq(generationDrafts.generationId, generationId), eq(generationDrafts.idx, idx)))
  return r.n
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${generations}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'gen-owner' }).returning({ id: users.id })
  userId = u.id
})

beforeEach(async () => {
  await db.delete(generations)
  const [g] = await db.insert(generations).values({ userId, query: 'борщ', lang: 'ru' }).returning({ id: generations.id })
  generationId = g.id
})

describe('повтор попытки не плодит черновики', () => {
  it('вторая запись того же витка ЗАМЕНЯЕТ первую', async () => {
    await saveDrafts(1, ['A', 'B', 'C'])
    expect(await countFor(1)).toBe(3)
    // Воркер перезапустил задачу — тот же виток пишется снова.
    await saveDrafts(1, ['A', 'B', 'C'])
    expect(await countFor(1)).toBe(3)
  })

  it('витки не мешают друг другу: замена трогает только свой idx', async () => {
    await saveDrafts(1, ['A', 'B'])
    await saveDrafts(2, ['A', 'B', 'C'])
    await saveDrafts(1, ['A'])
    expect(await countFor(1)).toBe(1)
    expect(await countFor(2)).toBe(3)
  })

  it('после замены остаются НОВЫЕ строки, а не смесь со старыми', async () => {
    await saveDrafts(1, ['A', 'B', 'C'])
    await saveDrafts(1, ['A'])
    const rows = await db
      .select({ letter: generationDrafts.letter })
      .from(generationDrafts)
      .where(and(eq(generationDrafts.generationId, generationId), eq(generationDrafts.idx, 1)))
    expect(rows.map((r) => r.letter)).toEqual(['A'])
  })
})
