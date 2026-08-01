import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Генерация, чью задачу похоронила очередь.
 *
 * Штатный провал закрывает сам виток в своём finally. А когда процесс убили на деплое или
 * OOM, до finally дело не доходит: задачу подбирает reaper, помечает failed — и генерация
 * остаётся в 'pending' НАВСЕГДА, то есть на экране вечный спиннер «совет совещается».
 * Закрывает её финализатор; здесь проверяется, что он закрывает ровно брошенные и не
 * трогает те, что успели договорить сами.
 */

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))

const { db, users, generations, generationMessages } = await import('@/shared/db')
const { abandonGeneration } = await import('@/features/generation/service')
const { parseFailure } = await import('@/shared/ai/failure')

let userId = ''
let genId = ''

beforeEach(async () => {
  await db.execute(sql`truncate table ${users}, ${generations} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'lost-user' }).returning({ id: users.id })
  userId = u.id
  const [g] = await db
    .insert(generations)
    .values({ userId, query: 'лучшие сайты для изучения китайского', status: 'pending' })
    .returning({ id: generations.id })
  genId = g.id
})

const status = async () => (await db.select({ s: generations.status }).from(generations).where(eq(generations.id, genId)))[0].s
const errors = async () =>
  (await db.select().from(generationMessages).where(eq(generationMessages.generationId, genId))).filter((m) => m.kind === 'error')

describe('брошенная генерация', () => {
  it('висящий pending закрывается, причина — «оборвалась»', async () => {
    await abandonGeneration(genId, 1)

    expect(await status()).toBe('failed')
    const [err] = await errors()
    expect(err).toBeTruthy()
    expect(parseFailure(err.text)?.code).toBe('lost')
  })

  it('успевшую доехать до done не трогаем и лишней ошибки в чат не пишем', async () => {
    await db.update(generations).set({ status: 'done' }).where(eq(generations.id, genId))

    await abandonGeneration(genId, 1)

    expect(await status()).toBe('done')
    expect(await errors()).toHaveLength(0)
  })

  it('виток уже объявил провал сам — второй реплики об ошибке не появляется', async () => {
    await db.update(generations).set({ status: 'failed' }).where(eq(generations.id, genId))

    await abandonGeneration(genId, 1)

    expect(await errors()).toHaveLength(0)
  })

  it('двойные похороны (reaper дважды) дают одну реплику, а не две', async () => {
    await abandonGeneration(genId, 1)
    await abandonGeneration(genId, 1)

    expect(await errors()).toHaveLength(1)
  })
})
