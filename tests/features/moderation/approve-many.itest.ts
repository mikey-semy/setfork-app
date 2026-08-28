import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLog, db, templates, users } from '@/shared/db'

/**
 * ОДОБРЕНИЕ ПАЧКОЙ: все строки разом, и журнал ПОИМЁННЫЙ.
 *
 * Владелец назвал это прямо — «одобрить массово невозможно»: очередь отдаёт до двухсот
 * строк, и после волны самогенерации в ней десятки однотипных черновиков.
 *
 * Проверяются два обещания, записанные в самом действии. Первое — одним запросом, а не
 * циклом: цикл дал бы частичный результат при обрыве. Второе — по записи журнала НА
 * КАЖДЫЙ список: аудит обязан отвечать на вопрос «кто одобрил вот этот», а запись
 * «одобрено сорок штук» на него не отвечает. Второе особенно нужно после того, как
 * журналирование переехало с цикла на одну вставку: тихо потерять поимённость легко.
 */
const ADMIN = 'am-admin'
const OWNER = 'am-owner'
const ctx: Record<string, string> = {}

vi.mock('@/shared/auth/admin', () => ({ getAdmin: async () => ({ userId: ctx.admin, handle: ADMIN }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

beforeEach(async () => {
  for (const h of [ADMIN, OWNER]) await db.delete(users).where(eq(users.handle, h))
  const [a] = await db.insert(users).values({ handle: ADMIN, name: ADMIN }).returning({ id: users.id })
  const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  ctx.admin = a.id
  ctx.owner = o.id
})

/** Три списка в очереди: два ждут разбора, один уже одобрен. */
async function queued() {
  const rows = await db
    .insert(templates)
    .values(
      (['pending', 'flagged', 'active'] as const).map((moderation, i) => ({
        ownerId: ctx.owner,
        slug: `am-${moderation}`,
        title: { en: `am-${i}` },
        currentVersion: 1,
        moderation,
      })),
    )
    .returning({ id: templates.id, moderation: templates.moderation })
  return rows
}

describe('одобрение пачкой', () => {
  it('одобряет все выбранные и пишет журнал на каждый', async () => {
    const { approveMany } = await import('@/features/moderation/actions')
    const rows = await queued()
    const ids = rows.filter((r) => r.moderation !== 'active').map((r) => r.id)

    const res = await approveMany(ids)
    expect(res).toEqual({ ok: ids.length })

    const after = await db.select({ m: templates.moderation }).from(templates).where(inArray(templates.id, ids))
    expect(after.map((r) => r.m)).toEqual(ids.map(() => 'active'))

    const log = await db.select({ t: auditLog.targetId }).from(auditLog).where(inArray(auditLog.targetId, ids))
    // Поимённо: по записи на список, а не одна на всю пачку.
    expect([...log.map((r) => r.t)].sort()).toEqual([...ids].sort())
  })

  it('пустой выбор не пишет в журнал ничего', async () => {
    const { approveMany } = await import('@/features/moderation/actions')
    const before = await db.select({ t: auditLog.targetId }).from(auditLog)
    expect(await approveMany([])).toEqual({ ok: 0 })
    const after = await db.select({ t: auditLog.targetId }).from(auditLog)
    expect(after.length).toBe(before.length)
  })
})
