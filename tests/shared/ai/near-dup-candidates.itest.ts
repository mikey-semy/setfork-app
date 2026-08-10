import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ОТБОР КАНДИДАТОВ на «такой список уже есть».
 *
 * Раньше выборка была `limit(40)` БЕЗ сортировки: у кого больше сорока подходящих
 * списков — а это ровно сценарий массовой генерации, ради которого проверка и
 * заведена, — в неё попадали произвольные сорок. Клон за их пределами не
 * сравнивался никогда и создавался как новый.
 *
 * Проверяем обещание функции: СВОИ списки сравниваются все.
 */
const { db, steps, templates, templateVersions, users } = await import('@/shared/db')
const { findExistingNearDuplicate } = await import('@/shared/ai/near-dup-check')

let ownerId = ''

async function makeList(slug: string, title: string, itemTitles: string[]) {
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { ru: title }, tags: ['кулинария'], currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'init' }).returning({ id: templateVersions.id })
  await db.insert(steps).values(itemTitles.map((t, i) => ({ versionId: v.id, n: i + 1, title: { ru: t }, desc: {} })))
  return tpl.id
}

beforeEach(async () => {
  await resetTables(sql`${templates}, ${users}`)
  const [u] = await db.insert(users).values({ handle: 'dup-owner' }).returning({ id: users.id })
  ownerId = u.id
})

describe('свои списки сравниваются ВСЕ, а не первые сорок', () => {
  it('клон находится, даже когда своих списков больше прежнего лимита', async () => {
    // 45 своих списков-«шумов», и только последний — настоящий клон.
    for (let i = 0; i < 45; i++) await makeList(`noise-${i}`, `Шумный список ${i}`, [`шаг ${i}`, `другой ${i}`])
    await makeList('twin', 'Борщ по-домашнему', ['Сварить бульон', 'Нашинковать свёклу', 'Добавить капусту'])

    const verdict = await findExistingNearDuplicate(
      { title: 'Борщ по-домашнему', items: ['Сварить бульон', 'Нашинковать свёклу', 'Добавить капусту'], tags: ['кулинария'] },
      { ownerId },
    )
    expect(verdict.match, 'клон за пределами прежних сорока кандидатов не найден').not.toBeNull()
    expect(verdict.best).toBeGreaterThan(0.5)
  })

  it('непохожий список дубликатом не объявляется', async () => {
    await makeList('other', 'Ремонт велосипеда', ['Снять колесо', 'Заклеить камеру'])
    const verdict = await findExistingNearDuplicate(
      { title: 'Борщ по-домашнему', items: ['Сварить бульон', 'Нашинковать свёклу'], tags: ['кулинария'] },
      { ownerId },
    )
    expect(verdict.match).toBeNull()
  })
})
