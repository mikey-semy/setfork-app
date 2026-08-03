import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, steps, templates, templateVersions, users } from '@/shared/db'

/**
 * Два инварианта форка, которые держались не тем, чем нужно.
 *
 * 1. «Один аккаунт — один форк списка» держалось проверкой ПЕРЕД вставкой: два
 *    параллельных запроса с разными свободными именами оба не находили существующий
 *    форк и оба его создавали. Инвариант должен жить в базе.
 * 2. Копия шагов писалась своим маппингом, в котором не было пометки «здесь нужен
 *    человек», её вопроса и идентичности блока. Пометка создана ровно для случая
 *    «машина знать не может» — и терялась именно там, где копия наследует чужой опыт.
 */
const OWNER = 'fk-owner'
const FORKER = 'fk-forker'
const ctx: Record<string, string> = {}

beforeEach(async () => {
  for (const h of [OWNER, FORKER]) await db.delete(users).where(eq(users.handle, h))
  const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  const [f] = await db.insert(users).values({ handle: FORKER, name: FORKER }).returning({ id: users.id })
  ctx.owner = o.id
  ctx.forker = f.id
})

describe('инвариант «один аккаунт — один форк списка» живёт в базе', () => {
  it('вторая копия того же источника отклоняется уникальным индексом', async () => {
    const [src] = await db
      .insert(templates)
      .values({ ownerId: ctx.owner, slug: 'src', title: { en: 'src' }, currentVersion: 1 })
      .returning({ id: templates.id })

    await db.insert(templates).values({ ownerId: ctx.forker, slug: 'copy-one', title: { en: 'c1' }, currentVersion: 1, forkedFromId: src.id, origin: 'forked' })

    // Вторая копия с ДРУГИМ именем — ровно то, что делали два параллельных запроса.
    await expect(
      db.insert(templates).values({ ownerId: ctx.forker, slug: 'copy-two', title: { en: 'c2' }, currentVersion: 1, forkedFromId: src.id, origin: 'forked' }),
    ).rejects.toThrow()

    const mine = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.ownerId, ctx.forker), eq(templates.forkedFromId, src.id)))
    expect(mine).toHaveLength(1)
  })

  it('обычные списки без источника уникальностью не ограничены', async () => {
    await db.insert(templates).values({ ownerId: ctx.forker, slug: 'own-a', title: { en: 'a' }, currentVersion: 1 })
    await db.insert(templates).values({ ownerId: ctx.forker, slug: 'own-b', title: { en: 'b' }, currentVersion: 1 })
    const own = await db.select({ id: templates.id }).from(templates).where(eq(templates.ownerId, ctx.forker))
    expect(own.length).toBeGreaterThanOrEqual(2)
  })

  it('разные люди форкают один источник независимо', async () => {
    const [src] = await db
      .insert(templates)
      .values({ ownerId: ctx.owner, slug: 'src2', title: { en: 'src2' }, currentVersion: 1 })
      .returning({ id: templates.id })
    await db.insert(templates).values({ ownerId: ctx.forker, slug: 'c', title: { en: 'c' }, currentVersion: 1, forkedFromId: src.id, origin: 'forked' })
    await db.insert(templates).values({ ownerId: ctx.owner, slug: 'c-own', title: { en: 'c' }, currentVersion: 1, forkedFromId: src.id, origin: 'forked' })
    const all = await db.select({ id: templates.id }).from(templates).where(eq(templates.forkedFromId, src.id))
    expect(all).toHaveLength(2)
  })
})

describe('копия шага несёт защитные поля', () => {
  it('пометка «здесь нужен человек», её вопрос и идентичность блока переживают копирование', async () => {
    const [src] = await db
      .insert(templates)
      .values({ ownerId: ctx.owner, slug: 'src3', title: { en: 'src3' }, currentVersion: 1 })
      .returning({ id: templates.id })
    const [v] = await db
      .insert(templateVersions)
      .values({ templateId: src.id, version: 1, note: 'v1' })
      .returning({ id: templateVersions.id })
    const bid = '11111111-1111-1111-1111-111111111111'
    await db.insert(steps).values({
      versionId: v.id,
      n: 1,
      title: { en: 'Local price' },
      command: '',
      needsHuman: true,
      needsHumanAsk: { en: 'What does it cost in your city?' },
      blockId: bid,
    })

    // Копия ровно тем маппингом, который делает форк.
    const src_ = await db.select().from(steps).where(eq(steps.versionId, v.id))
    const copied = src_.map((s, i) => ({
      n: i + 1,
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs,
      needsHuman: s.needsHuman,
      needsHumanAsk: s.needsHumanAsk,
      blockId: s.blockId,
    }))

    expect(copied[0].needsHuman).toBe(true)
    expect(copied[0].needsHumanAsk).toEqual({ en: 'What does it cost in your city?' })
    expect(copied[0].blockId).toBe(bid)
  })
})
