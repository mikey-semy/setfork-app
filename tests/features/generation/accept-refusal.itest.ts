import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПРИНЯТИЕ ВАРИАНТА, КОТОРЫЙ СТРАЖ НЕ ПРИНИМАЕТ — отказ значением, список не создан.
 * Настоящие база и фасад записи; подменены сессия и переходы Next.
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { to })
  },
}))

const { db, users, templates, generations, generationCandidates } = await import('@/shared/db')
const { acceptCandidate } = await import('@/features/generation/actions')

describe('acceptCandidate: отказ стража', () => {
  let genId = ''
  let candId = ''
  beforeAll(async () => {
    await resetTables([generationCandidates, generations, templates, users])
    const [u] = await db.insert(users).values({ handle: 'gen-refused' }).returning({ id: users.id })
    h.session = { userId: u.id, handle: 'gen-refused' }
    const [g] = await db.insert(generations).values({ userId: u.id, query: 'почистить сервер', status: 'done', lang: 'ru' } as never).returning({ id: generations.id })
    genId = g.id
    const [c] = await db
      .insert(generationCandidates)
      .values({
        generationId: g.id,
        idx: 1,
        title: 'Очистка',
        items: [{ title: 'Снести всё', desc: '', command: 'rm -rf /', level: 'required', why: '', subtasks: [], refs: [] }],
      } as never)
      .returning({ id: generationCandidates.id })
    candId = c.id
  })

  it('возвращает причину и шаг, список не создан', async () => {
    const res = await acceptCandidate(genId, candId)
    expect(res).toEqual({ refusal: { kind: 'destructive', reason: 'wipesFilesystem', step: '1' } })
    expect(await db.select().from(templates).where(eq(templates.slug, 'ochistka'))).toEqual([])
  })
})
