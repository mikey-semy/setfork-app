import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, generationCandidates, generations, templates, users } from '@/shared/db'
import { getListLineage, isLineageExact } from '@/features/library/lineage'
import { resetTables } from '../../helpers/reset-db'

// Родословная принятого списка отвечает на вопрос, который задают ПОЗЖЕ: «откуда это
// взялось?». Тут проверяется главное — что показывается провенанс ИМЕННО принятого варианта
// (у витка их несколько, у каждого свой), а остальные идут в «не выбрали». Ошибка здесь
// означала бы объяснение не про тот список — хуже, чем отсутствие объяснения.

let userId = ''
let tplId = ''

beforeAll(async () => {
  await resetTables(sql`${generationCandidates}, ${generations}, ${templates}, ${users}`)
  const [u] = await db.insert(users).values({ handle: 'lin-owner' }).returning({ id: users.id })
  userId = u.id
  const [t] = await db.insert(templates).values({ ownerId: userId, slug: 'bread', title: { ru: 'Хлеб' } }).returning({ id: templates.id })
  tplId = t.id
})

beforeEach(async () => {
  await db.delete(generationCandidates)
  await db.delete(generations)
})

const seedGeneration = async (chosenIdx: number | null) => {
  const [gen] = await db
    .insert(generations)
    .values({ userId, query: 'как испечь хлеб', chosenTemplateId: tplId, chosenIdx })
    .returning({ id: generations.id })
  await db.insert(generationCandidates).values([
    { generationId: gen.id, idx: 1, title: 'Вариант один', summary: 'первый', items: [], provenance: { engine: 'council', noBasis: ['нет прецедентов'] } },
    { generationId: gen.id, idx: 2, title: 'Вариант два', summary: 'второй', items: [], provenance: { engine: 'single' } },
    { generationId: gen.id, idx: 3, title: 'Вариант три', summary: 'третий', items: [], provenance: {} },
  ])
  return gen.id
}

describe('родословная принятого списка', () => {
  it('список сделан руками — родословной нет, и это не ошибка', async () => {
    expect(await getListLineage(tplId)).toBeNull()
    expect(await isLineageExact(tplId)).toBe(false)
  })

  it('показывается провенанс ИМЕННО принятого варианта', async () => {
    await seedGeneration(2)
    const lin = await getListLineage(tplId)
    expect(lin?.provenance).toMatchObject({ engine: 'single' })
    expect(lin?.query).toBe('как испечь хлеб')
    expect(await isLineageExact(tplId)).toBe(true)
  })

  it('остальные варианты идут в «не выбрали» — видна цена витка', async () => {
    await seedGeneration(2)
    const lin = await getListLineage(tplId)
    expect(lin?.rejected.map((r) => r.idx)).toEqual([1, 3])
    expect(lin?.rejected.map((r) => r.title)).toEqual(['Вариант один', 'Вариант три'])
  })

  it('старый виток без записанного индекса — берём первый и помечаем как неточное', async () => {
    await seedGeneration(null)
    const lin = await getListLineage(tplId)
    expect(lin?.provenance).toMatchObject({ engine: 'council' }) // первый кандидат
    expect(lin?.rejected).toHaveLength(2)
    expect(await isLineageExact(tplId)).toBe(false) // UI подпишет, что вариант мог быть другой
  })

  it('пробелы опоры доезжают до родословной — это самая честная её часть', async () => {
    await seedGeneration(1)
    const lin = await getListLineage(tplId)
    expect((lin?.provenance as { noBasis?: string[] }).noBasis).toEqual(['нет прецедентов'])
  })

  it('единственный кандидат — «не выбрали» пусто, а не список из него самого', async () => {
    const [gen] = await db.insert(generations).values({ userId, query: 'один вариант', chosenTemplateId: tplId, chosenIdx: 1 }).returning({ id: generations.id })
    await db.insert(generationCandidates).values({ generationId: gen.id, idx: 1, title: 'Единственный', summary: '', items: [], provenance: { engine: 'single' } })
    expect((await getListLineage(tplId))?.rejected).toEqual([])
  })
})
