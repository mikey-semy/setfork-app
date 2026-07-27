import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import { findExistingNearDuplicate } from '@/shared/ai/near-dup-check'

// Проверка «такой список уже есть» ходит в БД: сравнивать надо с ТЕКУЩИМИ версиями близких по
// теме списков. Тут проверяется именно выборка кандидатов — сама мера сходства покрыта
// юнитами. Ошибка в выборке страшнее ошибки в мере: клон просто не с чем будет сравнить.

let ownerId = ''
let otherId = ''

const seed = async (ownerId: string, slug: string, title: string, tags: string[], items: string[], over: Partial<typeof templates.$inferInsert> = {}) => {
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { ru: title }, tags, currentVersion: 1, status: 'published', visibility: 'public', ...over })
    .returning({ id: templates.id })
  const [ver] = await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'seed' }).returning({ id: templateVersions.id })
  if (items.length) {
    await db.insert(steps).values(items.map((t, i) => ({ versionId: ver.id, n: i + 1, title: { ru: t }, desc: {}, command: '', level: 'required' as const, why: {}, section: {}, subtasks: [], refs: [] })))
  }
  return tpl.id
}

const breadItems = ['Смешать муку воду соль дрожжи', 'Замесить тесто до гладкости', 'Дать подняться два часа', 'Сформовать буханку', 'Испечь при 240 градусах']
const rewordedFresh = {
  title: 'Печём хлеб дома своими руками',
  items: ['Смешайте муку с водой солью и дрожжами', 'Вымешивайте тесто пока не станет гладким', 'Оставьте подниматься на два часа', 'Сформуйте буханку', 'Выпекайте при 240 градусах'],
  tags: ['кулинария'],
}

/** Очистка списков между сценариями: точечные удаления вместо truncate cascade — под
 *  нагрузкой полного прогона cascade упирался в 5-секундный таймаут теста. */
const clearLists = async () => {
  await db.delete(steps)
  await db.delete(templateVersions)
  await db.delete(templates)
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${steps}, ${templateVersions}, ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'nd-owner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'nd-other' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
})

describe('выборка кандидатов для сравнения', () => {
  it('чужой ПУБЛИЧНЫЙ список с общим тегом — сравнивается (клон чужого тоже клон)', async () => {
    await seed(otherId, 'bread-pub', 'Как испечь хлеб дома', ['кулинария'], breadItems)
    const v = await findExistingNearDuplicate(rewordedFresh, { ownerId })
    expect(v.match?.title).toBe('Как испечь хлеб дома')
  })

  it('без общих тегов чужой список не тянем — проверка остаётся дешёвой', async () => {
    const v = await findExistingNearDuplicate({ ...rewordedFresh, tags: ['ремонт'] }, { ownerId })
    expect(v.match).toBeNull()
  })

  it('СВОЙ список сравнивается даже без общих тегов: себе же дубль обиднее всего', async () => {
    await seed(ownerId, 'bread-mine', 'Как испечь хлеб дома', [], breadItems, { status: 'draft' })
    const v = await findExistingNearDuplicate({ ...rewordedFresh, tags: ['ремонт'] }, { ownerId })
    expect(v.match?.title).toBe('Как испечь хлеб дома')
  })

  it('архивный не считается — он больше не в библиотеке', async () => {
    await clearLists()
    await seed(otherId, 'bread-arch', 'Как испечь хлеб дома', ['кулинария'], breadItems, { archivedAt: new Date() })
    expect((await findExistingNearDuplicate(rewordedFresh, { ownerId })).match).toBeNull()
  })

  it('исключение по id работает — список не дубликат сам себе при пересчёте', async () => {
    await clearLists()
    const id = await seed(ownerId, 'bread-self', 'Как испечь хлеб дома', ['кулинария'], breadItems)
    expect((await findExistingNearDuplicate(rewordedFresh, { ownerId, excludeId: id })).match).toBeNull()
    expect((await findExistingNearDuplicate(rewordedFresh, { ownerId })).match?.id).toBe(id)
  })

  it('сравнивается ТЕКУЩАЯ версия, а не первая: список изменился — сравнение тоже', async () => {
    await clearLists()
    const id = await seed(otherId, 'bread-v', 'Как испечь хлеб дома', ['кулинария'], breadItems)
    // v2 уводит список в другую тему — теперь наш хлеб ему не дубль.
    const [v2] = await db.insert(templateVersions).values({ templateId: id, version: 2, note: 'ушли в другое' }).returning({ id: templateVersions.id })
    await db.insert(steps).values(
      ['Настроить ssh по ключу', 'Поставить docker', 'Поднять reverse proxy'].map((t, i) => ({ versionId: v2.id, n: i + 1, title: { ru: t }, desc: {}, command: '', level: 'required' as const, why: {}, section: {}, subtasks: [], refs: [] })),
    )
    await db.update(templates).set({ currentVersion: 2 }).where(sql`${templates.id} = ${id}`)
    expect((await findExistingNearDuplicate(rewordedFresh, { ownerId })).match).toBeNull()
  })
})
