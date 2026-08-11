import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Линза 03 (деньги), №5: повтор дорогой задачи оплачивался заново. Задача 'generate'
// ставится с maxAttempts: 2 и вдобавок переподхватывается reapStalledJobs, а самая
// дорогая часть (совет ≈ 6.5 вызовов) шла ДО вставки кандидата — значит «упало после
// дорогой части» и «процесс умер на деплое» платили второй раз. Уникальность
// (generation_id, idx) защищала данные, но не деньги.
//
// Вызовы модели подменены СЧЁТЧИКОМ: ловим любой поход в ИИ.

const h = vi.hoisted(() => ({ council: 0, single: 0 }))
vi.mock('@/shared/ai/council', () => ({
  generateListCouncil: async () => {
    h.council++
    return null
  },
}))
vi.mock('@/shared/ai/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ai/generate')>()),
  generateListDraft: async () => {
    h.single++
    return { title: 'Список', desc: '', tags: ['кофе'], items: [{ title: 'Шаг 1', desc: 'делай так' }] }
  },
  generateChangeNote: async () => '',
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))

const { db, users, generations, generationCandidates } = await import('@/shared/db')
const { addCandidate } = await import('@/features/generation/service')

let userId = ''
let genId = ''

beforeEach(async () => {
  await resetTables([users, generations])
  const [u] = await db.insert(users).values({ handle: 'ret-user' }).returning({ id: users.id })
  userId = u.id
  const [g] = await db.insert(generations).values({ userId, query: 'как варить кофе' }).returning({ id: generations.id })
  genId = g.id
  h.council = 0
  h.single = 0
})

const candidates = () =>
  db.select().from(generationCandidates).where(and(eq(generationCandidates.generationId, genId), eq(generationCandidates.idx, 1)))

describe('повтор задачи генерации', () => {
  it('первая попытка платит и сохраняет кандидата', async () => {
    expect(await addCandidate(genId, userId, 'как варить кофе', 'ru', 1)).toBe(true)
    expect(h.single).toBe(1)
    expect(await candidates()).toHaveLength(1)
  })

  it('повтор того же idx НЕ зовёт модель второй раз', async () => {
    await addCandidate(genId, userId, 'как варить кофе', 'ru', 1)
    h.single = 0
    h.council = 0

    // Ровно то, что делают ретрай джобы и reapStalledJobs: тот же (generationId, idx).
    expect(await addCandidate(genId, userId, 'как варить кофе', 'ru', 1)).toBe(true)
    expect(h.single).toBe(0)
    expect(h.council).toBe(0)
    expect(await candidates()).toHaveLength(1)

    const [row] = await db.select({ status: generations.status }).from(generations).where(eq(generations.id, genId))
    expect(row.status).toBe('done') // спиннер не остаётся висеть
  })

  it('другой виток (idx) по-прежнему работает — идемпотентность не заклинивает «ещё вариант»', async () => {
    await addCandidate(genId, userId, 'как варить кофе', 'ru', 1)
    h.single = 0
    expect(await addCandidate(genId, userId, 'как варить кофе', 'ru', 2)).toBe(true)
    expect(h.single).toBe(1)
  })
})
