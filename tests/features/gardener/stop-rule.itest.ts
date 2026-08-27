import { count, sql } from 'drizzle-orm'
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

/** Опора времени — фиксированная и в прошлом: порядок не должен зависеть от часов машины. */
const BASE = Date.UTC(2026, 0, 1)

/** Номер вставки в пределах теста: он и задаёт время. */
let tick = 0

beforeEach(async () => {
  await db.delete(agentActions)
  await db.delete(templates).where(sql`${templates.forkedFromId} is not null`)
  tick = 0
  // Подготовка утверждает свой результат: иначе оборванное соединение к базе даёт молча
  // непочищенный журнал, и красным приходит утверждение про правило остановки вместо
  // правды «не удалось подготовить состояние».
  const [{ n }] = await db.select({ n: count() }).from(agentActions)
  expect(n, 'подготовка теста не удалась: журнал agent_actions не очистился').toBe(0)
})

/**
 * ⚠️ Время задаётся ЯВНО, а не пересчитывается из `ctid` — тот приём неверен по построению.
 * `ctid` это физическое место строки, и каждый `UPDATE` переписывает её на новое; как только
 * таблица занимает больше одной страницы, отсчёт смещений начинается заново, и порядок «по
 * вставке» ломается. Подробный разбор — в `tests/shared/agents/stall.itest.ts`, где тот же
 * приём ронял проверку окна в CI и выглядел протечкой между тестами.
 */
const nextAt = () => new Date(BASE + (tick += 1) * 1000)

const act = async (action: string, templateId = tplId) => {
  await db.insert(agentActions).values({ loop: 'gardener', action, resultStatus: 'skipped', signal: { templateId }, occurredAt: nextAt() })
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

  // Сухой прогон пишет решение, которое НЕ исполнялось. Считать его действием значит
  // обнулять историю устойчивости самим фактом наблюдения — включил «посмотреть», и
  // расхождение форком откладывается.
  it('сухой прогон историю не обнуляет: наблюдение не меняет наблюдаемое', async () => {
    await act('list.stable')
    await db.insert(agentActions).values({ loop: 'gardener', action: 'list.suggest', resultStatus: 'dry-run', signal: { templateId: tplId }, occurredAt: nextAt() })
    await act('list.stable')
    expect(await stablePasses(tplId)).toBe(2)
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
