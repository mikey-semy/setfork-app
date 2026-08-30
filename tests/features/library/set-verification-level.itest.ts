import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLog, db, templates, templateVersions, users } from '@/shared/db'

/**
 * РУЧКА УРОВНЯ ПРОВЕРКИ: кто ставит, на что ложится, что стирает.
 *
 * Без ручки поле мертво — `machine_run` проставит прогон, а всё остальное ставит
 * человек, который список проверил. Проверяется не «работает ли update», а три
 * свойства, каждое из которых ломается молча.
 */
const OWNER = 'sv-owner'
const OTHER = 'sv-other'
const ctx: Record<string, string> = {}

vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: ctx.actor, handle: OWNER }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

beforeEach(async () => {
  for (const h of [OWNER, OTHER]) await db.delete(users).where(eq(users.handle, h))
  const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: OTHER, name: OTHER }).returning({ id: users.id })
  ctx.owner = o.id
  ctx.other = x.id
  ctx.actor = o.id
})

async function listWithVersion(slug: string, versions = 1) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: slug }, currentVersion: versions })
    .returning({ id: templates.id })
  for (let v = 1; v <= versions; v++) await db.insert(templateVersions).values({ templateId: t.id, version: v })
  return t.id
}

const level = async (id: string, version: number) => {
  const [row] = await db
    .select({ l: templateVersions.verificationLevel, at: templateVersions.verifiedAt, env: templateVersions.verifiedEnv })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, id))
    .orderBy(templateVersions.version)
  const all = await db
    .select({ v: templateVersions.version, l: templateVersions.verificationLevel })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, id))
  return { first: row, all, of: all.find((r) => r.v === version) }
}

describe('постановка уровня проверки', () => {
  it('ложится на ТЕКУЩУЮ версию и не трогает прошлые', async () => {
    const { setVerificationLevel } = await import('@/features/library/actions/verification')
    const id = await listWithVersion('sv-two', 2)
    expect(await setVerificationLevel(id, 'crystal', 'Ubuntu 24.04')).toEqual({ ok: true })
    const { all } = await level(id, 2)
    expect(all.map((r) => r.l)).toEqual(['rock', 'crystal'])
  })

  it('снятие уровня стирает дату и окружение', async () => {
    // Метка «не проверялось» с датой проверки читалась бы как «проверяли и не вышло».
    const { setVerificationLevel } = await import('@/features/library/actions/verification')
    const id = await listWithVersion('sv-clear')
    await setVerificationLevel(id, 'cut', 'macOS 15')
    await setVerificationLevel(id, 'rock', '')
    const { first } = await level(id, 1)
    expect([first.l, first.at, first.env]).toEqual(['rock', null, null])
  })

  it('чужой список не трогается', async () => {
    const { setVerificationLevel } = await import('@/features/library/actions/verification')
    const id = await listWithVersion('sv-foreign')
    ctx.actor = ctx.other
    try {
      expect(await setVerificationLevel(id, 'crystal', '')).toEqual({ error: 'not-allowed' })
      const { first } = await level(id, 1)
      expect(first.l).toBe('rock')
    } finally {
      ctx.actor = ctx.owner
    }
  })

  it('список без строки версии отвечает ошибкой, а не «готово»', async () => {
    // Аномалия данных: молчаливое «ок» означало бы, что человек считает уровень
    // проставленным, а его нет нигде.
    const { setVerificationLevel } = await import('@/features/library/actions/verification')
    const [t] = await db
      .insert(templates)
      .values({ ownerId: ctx.owner, slug: 'sv-noversion', title: { en: 'x' }, currentVersion: 1 })
      .returning({ id: templates.id })
    expect(await setVerificationLevel(t.id, 'crystal', '')).toEqual({ error: 'no-version' })
  })

  it('пишет в журнал: кто, какой уровень, какой версии', async () => {
    const { setVerificationLevel } = await import('@/features/library/actions/verification')
    const id = await listWithVersion('sv-audit')
    await db.delete(auditLog).where(eq(auditLog.targetId, id))
    await setVerificationLevel(id, 'doc_checked', 'docs only')
    const rows = await db.select({ a: auditLog.action, m: auditLog.meta }).from(auditLog).where(eq(auditLog.targetId, id))
    expect(rows).toHaveLength(1)
    expect(rows[0].a).toBe('list.verify')
    expect(rows[0].m).toMatchObject({ verificationLevel: 'doc_checked', version: 1 })
  })
})
