import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Подсчёт репутации против РЕАЛЬНОЙ БД. Чистая формула repScore покрыта юнитом, а сам
// подсчёт — сложный SQL (подзапрос drafters, count distinct filter, sum(1.0/N) filter) —
// не был покрыт ничем. Главный инвариант: сумма разделённого кредита за одну принятую
// генерацию равна 1, СКОЛЬКО БЫ ВИТКОВ в беседе ни было.

const { db, generationMessages, generations, gnomeThanks, templates, users } = await import('@/shared/db')
const { gnomeReputation, repScore, gnomeUserThanks, gnomeUserAccepts, gnomeThanksCounts } = await import('@/shared/ai/gnome-reputation')

let userId = ''
let tplId = ''

/** Генерация с набросчиками; accepted → выбран список. */
const genWith = async (drafters: string[], accepted: boolean, extra: { kind?: string; who?: string | null }[] = []) => {
  const [g] = await db
    .insert(generations)
    .values({ userId, query: 'q', chosenTemplateId: accepted ? tplId : null })
    .returning({ id: generations.id })
  for (const who of drafters) await db.insert(generationMessages).values({ generationId: g.id, kind: 'draft', who, text: 'черновик' })
  for (const e of extra) await db.insert(generationMessages).values({ generationId: g.id, kind: e.kind ?? 'critique', who: e.who ?? null, text: 'реплика' })
  return g.id
}

beforeEach(async () => {
  await resetTables(sql`${gnomeThanks}, ${generationMessages}, ${generations}, ${templates}, ${users}`)
  const [u] = await db.insert(users).values({ handle: 'rep-user' }).returning({ id: users.id })
  userId = u.id
  const [t] = await db.insert(templates).values({ ownerId: userId, slug: 'rep-list', title: { ru: 'Список' } }).returning({ id: templates.id })
  tplId = t.id
  // Кэш репутации живёт 5 минут — сбрасываем модуль между кейсами.
  await new Promise((r) => setTimeout(r, 0))
})
afterAll(async () => {
  await resetTables(sql`${gnomeThanks}, ${generationMessages}, ${generations}, ${templates}, ${users}`)
})

/** Свежая репутация без кэша: кэш живёт внутри модуля, поэтому перечитываем модуль. */
const freshRep = async () => {
  vi.resetModules()
  const mod = await import('@/shared/ai/gnome-reputation')
  return mod.gnomeReputation()
}

describe('подсчёт репутации по журналу бесед', () => {
  it('одиночный набросчик принятой генерации получает полный кредит', async () => {
    await genWith(['chef'], true)
    const rep = await freshRep()
    expect(rep.chef).toMatchObject({ gens: 1, accepted: 1 })
    expect(rep.chef.acceptedShare).toBeCloseTo(1, 5)
  })

  it('КРЕДИТ ДЕЛИТСЯ: три набросчика одной принятой генерации получают по 1/3, сумма = 1', async () => {
    await genWith(['chef', 'coder', 'scholar'], true)
    const rep = await freshRep()
    for (const id of ['chef', 'coder', 'scholar']) expect(rep[id].acceptedShare).toBeCloseTo(1 / 3, 5)
    const total = ['chef', 'coder', 'scholar'].reduce((s, id) => s + rep[id].acceptedShare, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('непринятая генерация считается опытом, но не заслугой', async () => {
    await genWith(['chef'], false)
    const rep = await freshRep()
    expect(rep.chef).toMatchObject({ gens: 1, accepted: 0 })
    expect(rep.chef.acceptedShare).toBeCloseTo(0, 5)
  })

  it('реплики не-draft (критика, голоса) в репутацию не идут', async () => {
    await genWith(['chef'], true, [{ kind: 'critique', who: 'critic' }, { kind: 'voice', who: 'hoarder' }])
    const rep = await freshRep()
    expect(Object.keys(rep)).toEqual(['chef'])
  })

  it('несколько витков одной беседы кредит НЕ удваивают', async () => {
    // Человек нажал «ещё вариант» — в ОДНОЙ генерации два витка, и тот же гном дал черновик
    // дважды. Кредит всё равно один: считается участие в генерации, а не число реплик.
    await genWith(['chef', 'chef'], true)
    const rep = await freshRep()
    expect(rep.chef.gens).toBe(1)
    expect(rep.chef.accepted).toBe(1)
    expect(rep.chef.acceptedShare).toBeCloseTo(1, 5)
  })

  it('балл отбора не перескакивает потолок из-за длинных бесед', async () => {
    for (let i = 0; i < 6; i++) await genWith(['chef', 'chef'], true)
    const rep = await freshRep()
    expect(rep.chef.acceptedShare / rep.chef.gens).toBeCloseTo(1, 5)
    expect(repScore(rep, 'chef')).toBe(1)
  })

  it('два гнома в двух витках: сумма кредита за генерацию остаётся 1', async () => {
    await genWith(['chef', 'coder', 'chef', 'coder'], true)
    const rep = await freshRep()
    expect(rep.chef.acceptedShare).toBeCloseTo(0.5, 5)
    expect(rep.coder.acceptedShare).toBeCloseTo(0.5, 5)
    expect(rep.chef.acceptedShare + rep.coder.acceptedShare).toBeCloseTo(1, 5)
  })

  it('накопление по нескольким генерациям: доля принятых считается верно', async () => {
    await genWith(['chef'], true)
    await genWith(['chef'], true)
    await genWith(['chef'], false)
    await genWith(['coder'], false)
    const rep = await freshRep()
    expect(rep.chef).toMatchObject({ gens: 3, accepted: 2 })
    expect(rep.coder).toMatchObject({ gens: 1, accepted: 0 })
  })

  it('балл отбора: уважаемый впереди слабого, новичок между ними (нейтральные 0.5)', async () => {
    for (let i = 0; i < 6; i++) await genWith(['chef'], true)
    for (let i = 0; i < 6; i++) await genWith(['coder'], false)
    const rep = await freshRep()
    const chef = repScore(rep, 'chef')
    const coder = repScore(rep, 'coder')
    const newbie = repScore(rep, 'нет-такого')
    expect(chef).toBeGreaterThan(newbie)
    expect(newbie).toBeGreaterThan(coder)
    expect(newbie).toBeCloseTo(0.5, 5)
  })
})

describe('персональные счётчики', () => {
  it('«спасибо» считается по паре гном+человек, чужие не примешиваются', async () => {
    const [other] = await db.insert(users).values({ handle: 'rep-other' }).returning({ id: users.id })
    await db.insert(gnomeThanks).values([
      { gnomeId: 'chef', userId, source: 'dig' },
      { gnomeId: 'chef', userId, source: 'dig' },
      { gnomeId: 'chef', userId: other.id, source: 'dig' },
      { gnomeId: 'coder', userId, source: 'dig' },
    ])
    expect(await gnomeUserThanks('chef', userId)).toBe(2)
    expect(await gnomeUserThanks('coder', userId)).toBe(1)
    expect(await gnomeUserThanks('scholar', userId)).toBe(0)
    expect(await gnomeThanksCounts()).toMatchObject({ chef: 3, coder: 1 })
  })

  it('«сколько раз я принимал его черновик» считается по МОИМ генерациям', async () => {
    await genWith(['chef'], true)
    await genWith(['chef'], false)
    expect(await gnomeUserAccepts('chef', userId)).toBe(1)
    const [other] = await db.insert(users).values({ handle: 'rep-third' }).returning({ id: users.id })
    expect(await gnomeUserAccepts('chef', other.id)).toBe(0)
  })
})
