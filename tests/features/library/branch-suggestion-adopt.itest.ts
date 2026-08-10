import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Окно выкатки Ф5: до неё ветку правки называло ядро по НИКУ, после — по
// неизменному идентификатору. Магический пуш, сделанный в это окно, попадает в
// `u/<ник>/main`; следующая ревизия того же человека приходит уже в
// `u/<id>/main`. Дедупликация идёт строго по ветке, поэтому без переноса
// появлялось бы ВТОРОЕ предложение, а первое висело бы открытым и обновить его
// было бы нечем (авто-ревью core#80).
//
// Против настоящего Postgres: правило держится на запросе с регулярным
// выражением по имени ветки, и двойник базы проверял бы только двойника.

const { db, templates, users, suggestions, templateVersions } = await import('@/shared/db')
const { ensureBranchSuggestion } = await import('@/features/library/suggestion-core')

let ownerId = ''
let authorId = ''
let otherId = ''

async function seedTemplate(): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({
      ownerId,
      slug: `s-${Math.random().toString(36).slice(2)}`,
      title: { en: 'S' },
      status: 'published',
      visibility: 'public',
      currentVersion: 1,
    })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'init' })
  return t.id
}

async function seedBranchSuggestion(templateId: string, branchRef: string, who = authorId): Promise<string> {
  const [s] = await db
    .insert(suggestions)
    .values({
      templateId,
      authorId: who,
      baseVersion: 1,
      status: 'open',
      note: `Merge branch '${branchRef}'`,
      items: [],
      branchRef,
      number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${templateId})`,
    })
    .returning({ id: suggestions.id })
  return s.id
}

const branchOf = async (id: string) =>
  (await db.query.suggestions.findFirst({ where: (s, { eq }) => eq(s.id, id) }))?.branchRef

const openCount = async (templateId: string) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(sql`${suggestions.templateId} = ${templateId} and ${suggestions.status} = 'open'`)
  return r?.n ?? 0
}

const ID_BRANCH = 'u/0d5a3f6e-6a1c-4a25-9f5f-2b0a1c9d7e11/main'

beforeEach(async () => {
  await resetTables(sql`${templates}, ${users}`)
  const [o] = await db.insert(users).values({ handle: 'bowner' }).returning({ id: users.id })
  const [a] = await db.insert(users).values({ handle: 'bauthor' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'bother' }).returning({ id: users.id })
  ownerId = o.id
  authorId = a.id
  otherId = x.id
})
afterAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
})

describe('ветка правки сменила имя в окно выкатки', () => {
  it('ревизия продолжает ТО ЖЕ предложение, а не заводит второе', async () => {
    const tpl = await seedTemplate()
    const legacy = await seedBranchSuggestion(tpl, 'u/bauthor/main')

    const res = await ensureBranchSuggestion({
      templateId: tpl,
      ownerId,
      currentVersion: 1,
      authorId,
      branch: ID_BRANCH,
      legacyBranch: 'u/bauthor/main',
    })

    expect(res.id).toBe(legacy)
    expect(res.created).toBe(false)
    expect(await branchOf(legacy)).toBe(ID_BRANCH)
    expect(await openCount(tpl)).toBe(1)
  })

  it('чужое предложение не забирает', async () => {
    const tpl = await seedTemplate()
    const foreign = await seedBranchSuggestion(tpl, 'u/bother/main', otherId)

    const res = await ensureBranchSuggestion({
      templateId: tpl,
      ownerId,
      currentVersion: 1,
      authorId,
      branch: ID_BRANCH,
      legacyBranch: 'u/bother/main', // даже если имя названо — предложение чужое
    })

    expect(res.created).toBe(true)
    expect(res.id).not.toBe(foreign)
    expect(await branchOf(foreign)).toBe('u/bother/main')
  })

  /**
   * Ключевое ограничение: правило берёт ТОЛЬКО ветки, названные по нику. Иначе
   * второе предложение того же автора, уже заведённое по идентификатору, было
   * бы «усыновлено» чужим пушем — и человек потерял бы свою правку.
   */
  it('предложение с веткой по идентификатору не трогает', async () => {
    const tpl = await seedTemplate()
    const other = 'u/9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f/main'
    const existing = await seedBranchSuggestion(tpl, other)

    const res = await ensureBranchSuggestion({
      templateId: tpl,
      ownerId,
      currentVersion: 1,
      authorId,
      branch: ID_BRANCH,
      legacyBranch: 'u/bauthor/main',
    })

    expect(res.created).toBe(true)
    expect(await branchOf(existing)).toBe(other)
    expect(await openCount(tpl)).toBe(2)
  })

  it('другая база ветки — другое предложение', async () => {
    const tpl = await seedTemplate()
    const legacy = await seedBranchSuggestion(tpl, 'u/bauthor/draft')

    const res = await ensureBranchSuggestion({
      templateId: tpl,
      ownerId,
      currentVersion: 1,
      authorId,
      branch: ID_BRANCH,
      legacyBranch: 'u/bauthor/main', // ревизия к main, а не к draft
    })

    expect(res.created).toBe(true)
    expect(await branchOf(legacy)).toBe('u/bauthor/draft')
  })

  /**
   * `u/team/main` — законное имя: владелец вправе завести такую ветку пушем из
   * терминала. Подбор идёт по ТОЧНОМУ старому имени этого автора, поэтому
   * предложение с рукотворной ветки вместе с его обсуждением остаётся на месте
   * (авто-ревью fe#662).
   */
  it('рукотворную ветку того же автора не забирает', async () => {
    const tpl = await seedTemplate()
    const handmade = await seedBranchSuggestion(tpl, 'u/team/main')

    const res = await ensureBranchSuggestion({
      templateId: tpl,
      ownerId,
      currentVersion: 1,
      authorId,
      branch: ID_BRANCH,
      legacyBranch: 'u/bauthor/main',
    })

    expect(res.created).toBe(true)
    expect(await branchOf(handmade)).toBe('u/team/main')
    expect(await openCount(tpl)).toBe(2)
  })
})
