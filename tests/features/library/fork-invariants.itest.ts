import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Граница Next-рантайма подменяется, ПРОВЕРЯЕМЫЙ КОД — нет: тест зовёт настоящий
// forkTemplate. Прежняя версия переписывала его маппинг внутри себя и проверяла свою
// копию — то есть зеленела при любом поведении форка (именно так потеря `danger` и
// дожила до прода).
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const e = new Error('REDIRECT') as Error & { url: string }
    e.url = url
    throw e
  },
}))

const { db, steps, templates, templateVersions, users } = await import('@/shared/db')
const { forkTemplate } = await import('@/features/library/actions/forks')

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
  it('⚠️ «нужен человек», его вопрос, идентичность блока и «разрушительный пункт» переживают ФОРК', async () => {
    const [src] = await db
      .insert(templates)
      .values({ ownerId: ctx.owner, slug: 'src3', title: { en: 'src3' }, currentVersion: 1, visibility: 'public', status: 'published' })
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
      // Команда ВЫГЛЯДИТ разрушительной, и автор пометил её как такую: копия обязана
      // донести решение автора, а не переспросить детектор.
      command: 'make reset',
      danger: true,
      needsHuman: true,
      needsHumanAsk: { en: 'What does it cost in your city?' },
      blockId: bid,
    })

    // ⚠️ Зовём НАСТОЯЩИЙ форк, а не его копию: иначе тест проверяет сам себя.
    h.session = { userId: ctx.forker, handle: FORKER }
    try {
      await forkTemplate(src.id)
    } catch (e) {
      if ((e as Error).message !== 'REDIRECT') throw e
    }

    const [copy] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.ownerId, ctx.forker), eq(templates.forkedFromId, src.id)))
    expect(copy, 'форк должен был создаться').toBeTruthy()
    const [cv] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, copy.id))
    const [copied] = await db.select().from(steps).where(eq(steps.versionId, cv.id))

    expect(copied.needsHuman, 'пометка «здесь нужен человек» потеряна').toBe(true)
    expect(copied.needsHumanAsk).toEqual({ en: 'What does it cost in your city?' })
    expect(copied.blockId, 'идентичность блока потеряна').toBe(bid)
    expect(copied.danger, 'пометка «разрушительный пункт» потеряна — команда станет исполняемой в собранном скрипте').toBe(true)
  })
})
