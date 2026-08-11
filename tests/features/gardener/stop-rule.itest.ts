import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentActions, db, templates, users } from '@/shared/db'
import { alreadyForked, stablePasses } from '@/features/gardener/service'
import { resetTables } from '../../helpers/reset-db'

// ПРАВИЛО ОСТАНОВКИ: список, который два прохода подряд не меняется, дальше полировать
// вредно — улучшения тоже портят. Счётчик считается по журналу действий, поэтому проверяем
// его на реальных строках: важно, что считается «подряд», а не «всего», иначе одна старая
// запись «устоялся» вечно держала бы список в состоянии «пора расходиться».

let ownerId = ''
let tplId = ''
let otherId = ''

beforeAll(async () => {
  await resetTables([agentActions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'sr-agent', accountType: 'agent' }).returning({ id: users.id })
  ownerId = u.id
  const [t] = await db.insert(templates).values({ ownerId, slug: 'stew', title: { ru: 'Рагу' } }).returning({ id: templates.id })
  tplId = t.id
  const [o] = await db.insert(templates).values({ ownerId, slug: 'other', title: { ru: 'Другое' } }).returning({ id: templates.id })
  otherId = o.id
})

beforeEach(async () => {
  await db.delete(agentActions)
  await db.delete(templates).where(sql`${templates.forkedFromId} is not null`)
})

const act = async (action: string, templateId = tplId) => {
  await db.insert(agentActions).values({ loop: 'gardener', action, resultStatus: 'skipped', signal: { templateId } })
  // Журнал упорядочен по occurred_at: раздвигаем записи, иначе порядок внутри такта не определён.
  await db.execute(sql`update ${agentActions} set occurred_at = now() + (ctid::text::point)[1] * interval '1 millisecond'`)
}

describe('правило остановки', () => {
  it('ни одного «устоялся» — счётчик ноль', async () => {
    expect(await stablePasses(tplId)).toBe(0)
  })

  it('два подряд — порог достигнут', async () => {
    await act('list.stable')
    await act('list.stable')
    expect(await stablePasses(tplId)).toBe(2)
  })

  it('правка между проходами ОБНУЛЯЕТ счётчик: список снова живой', async () => {
    await act('list.stable')
    await act('list.improve')
    await act('list.stable')
    expect(await stablePasses(tplId)).toBe(1)
  })

  it('чужие списки в счёт не идут', async () => {
    await act('list.stable', otherId)
    await act('list.stable', otherId)
    expect(await stablePasses(tplId)).toBe(0)
  })
})

describe('один форк на источник', () => {
  it('форка нет — расходиться можно', async () => {
    expect(await alreadyForked(tplId, [ownerId])).toBe(false)
  })

  it('форк служебного аккаунта есть — второй раз не расходимся', async () => {
    await db.insert(templates).values({ ownerId, slug: 'stew-budget', title: { ru: 'Рагу на бюджете' }, forkedFromId: tplId, origin: 'forked' })
    expect(await alreadyForked(tplId, [ownerId])).toBe(true)
  })

  it('форк ЧЕЛОВЕКА не мешает компании разойтись — это разные истории', async () => {
    const [h] = await db.insert(users).values({ handle: 'sr-human', email: 'h@example.com' }).returning({ id: users.id })
    await db.insert(templates).values({ ownerId: h.id, slug: 'stew-mine', title: { ru: 'Моё рагу' }, forkedFromId: tplId, origin: 'forked' })
    expect(await alreadyForked(tplId, [ownerId])).toBe(false)
  })
})
