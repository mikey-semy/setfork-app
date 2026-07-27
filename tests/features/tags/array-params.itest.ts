import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, tags, templates, users } from '@/shared/db'
import { knownTagSlugs } from '@/features/tags/queries'
import { recomputeTagUsage } from '@/features/tags/service'

// Регрессия на класс бага, найденный 2026-07-27 в петле садовника: в шаблоне `sql`
// массив разворачивается в СПИСОК параметров, поэтому `= any(${arr})` даёт
// `any(($1, $2))` и Postgres падает «malformed array literal». Правильная форма —
// `sql.param(arr)` или drizzle-операторы (inArray). Обе функции ниже были написаны
// сломанной формой и не имели покрытия вовсе — падали на ЛЮБОМ непустом входе.

beforeAll(async () => {
  await db.execute(sql`truncate table ${tags}, ${templates}, ${users} restart identity cascade`)
  const [owner] = await db.insert(users).values({ handle: 'tag-owner' }).returning({ id: users.id })
  await db.insert(tags).values([{ slug: 'cooking' }, { slug: 'deploy' }, { slug: 'unused' }])
  await db.insert(templates).values([
    { ownerId: owner.id, slug: 'borsch', title: { ru: 'Борщ' }, tags: ['cooking'] },
    { ownerId: owner.id, slug: 'shchi', title: { ru: 'Щи' }, tags: ['cooking'] },
    { ownerId: owner.id, slug: 'vps', title: { en: 'VPS' }, tags: ['deploy'], visibility: 'private' },
  ])
})

const usage = async (slug: string) => {
  const [r] = await db.select({ n: tags.usageCount }).from(tags).where(sql`${tags.slug} = ${slug}`)
  return r?.n ?? -1
}

describe('теги: массив как ОДИН параметр', () => {
  it('knownTagSlugs находит известные и не находит выдуманные', async () => {
    const found = await knownTagSlugs(['cooking', 'deploy', 'nope'])
    expect([...found].sort()).toEqual(['cooking', 'deploy'])
  })

  it('knownTagSlugs на пустом входе не идёт в БД', async () => {
    expect((await knownTagSlugs([])).size).toBe(0)
  })

  it('recomputeTagUsage с ограничением набором slug', async () => {
    await recomputeTagUsage(['cooking'])
    expect(await usage('cooking')).toBe(2) // два публичных списка
    expect(await usage('deploy')).toBe(0) // не пересчитывали — остался дефолт
  })

  it('recomputeTagUsage без ограничения считает всё; приватный список не в счёт', async () => {
    await recomputeTagUsage()
    expect(await usage('cooking')).toBe(2)
    expect(await usage('deploy')).toBe(0) // единственный список с тегом — приватный
    expect(await usage('unused')).toBe(0)
  })
})
