import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// ЖУРНАЛ ПРОХОДА на реальной БД, с замоканной моделью.
//
// Зачем отдельный тест: правило остановки уже покрыто (stop-rule.itest.ts), но оно
// проверялось на строках, которые тест писал САМ — и в правильной форме. Рабочий код
// писал сигнал иначе (без templateId), а две самые частые ветки не писали вовсе.
// Тест был зелёным, «День компании» — пустым, счётчик «устоялся» не обнулялся.
// Поэтому здесь журнал проверяется по следам НАСТОЯЩЕГО прохода.
type Item = { title: string; desc: string; command: string; level: 'required'; why: string; subtasks: string[]; refs: { label: string; url: string }[] }
const item = (title: string): Item => ({ title, desc: 'что делать', command: '', level: 'required', why: '', subtasks: [], refs: [] })

const ai = vi.hoisted(() => ({ reply: null as null | { title: string; desc: string; tags: string[]; items: unknown[] } }))
vi.mock('@/shared/ai/generate', () => ({
  generateListRefine: vi.fn(async () => ai.reply),
}))
// Обход ссылок ходит наружу — в тесте он не нужен и только замедляет.
vi.mock('@/shared/lib/link-health', () => ({ checkUrls: vi.fn(async () => new Map<string, string>()) }))
// Ворота на входе прохода: ключ провайдера, дневной кап и предохранитель. Проверяются
// своими тестами; здесь они бы просто не пустили проход дальше первой строки.
vi.mock('@/shared/settings/ai', async (orig) => ({ ...(await orig<Record<string, unknown>>()), isAiAvailable: vi.fn(async () => true) }))
vi.mock('@/shared/quota', async (orig) => ({ ...(await orig<Record<string, unknown>>()), globalBudgetOk: vi.fn(async () => true) }))

const { agentActions, db, templates, templateVersions, steps, suggestions, users } = await import('@/shared/db')
const { runGardenerSweep, stablePasses } = await import('@/features/gardener/service')
const { snapshotOf } = await import('@/features/gardener/sweep/snapshot')

let humanId = ''
let tplId = ''

/** Публичный список ЖИВОГО человека: компания правит его предложением. */
const seedList = async () => {
  const [h] = await db.insert(users).values({ handle: 'gj-human', email: 'gj@example.com' }).returning({ id: users.id })
  humanId = h.id
  const [t] = await db
    .insert(templates)
    .values({ ownerId: humanId, slug: 'gj-list', title: { ru: 'Список' }, tags: ['devops'], status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  tplId = t.id
  const [v] = await db.insert(templateVersions).values({ templateId: tplId, version: 1, authorId: humanId }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { ru: 'Старый шаг' } })
  await db.update(templates).set({ currentVersion: 1 }).where(sql`${templates.id} = ${tplId}`)
}

beforeAll(async () => {
  await resetTables([agentActions, suggestions, steps, templateVersions, templates, users])
})

beforeEach(async () => {
  await resetTables([agentActions, suggestions, steps, templateVersions, templates, users])
  await seedList()
})

describe('журнал прохода садовника', () => {
  it('открытое предложение попадает в журнал — иначе работа компании не видна', async () => {
    ai.reply = { title: 'Список', desc: '', tags: ['devops'], items: [item('Новый шаг'), item('Ещё шаг')] }

    const res = await runGardenerSweep()

    expect(res.proposed).toBe(1)
    const rows = await db.select().from(agentActions)
    expect(rows.map((r) => r.action)).toContain('list.suggest')
  })

  it('сигнал несёт templateId — по нему правило остановки ищет прошлые действия', async () => {
    ai.reply = { title: 'Список', desc: '', tags: ['devops'], items: [item('Новый шаг')] }
    await runGardenerSweep()

    const [row] = await db.select().from(agentActions)
    expect((row.signal as { templateId?: string }).templateId).toBe(tplId)
    // Действие по списку обнуляет счётчик «устоялся»: до правки сигнала оно было
    // невидимым, и список копил «устоялся» до преждевременного форка.
    await db.insert(agentActions).values({ loop: 'gardener', action: 'list.stable', resultStatus: 'skipped', signal: { templateId: tplId } })
    expect(await stablePasses(tplId)).toBe(1)
  })

  it('«улучшать нечего» пишется как «устоялся», а не как правка', async () => {
    // Модель вернула ТО ЖЕ содержимое — правку открывать не за что. Ответ собираем из
    // снимка, а не вручную: сравнение идёт по нормализованному содержимому целиком, и
    // «то же самое» должно быть тем же самым по всем полям блока, а не только по заголовку.
    const snap = await snapshotOf({ id: tplId, currentVersion: 1, title: { ru: 'Список' }, desc: null, tags: ['devops'], listKind: null })
    ai.reply = { title: snap.current.title, desc: snap.current.desc, tags: snap.current.tags, items: snap.current.items }

    const res = await runGardenerSweep()

    expect(res.proposed).toBe(0)
    const rows = await db.select().from(agentActions)
    expect(rows.map((r) => r.action)).toEqual(['list.stable'])
    expect(await stablePasses(tplId)).toBe(1)
  })
})
