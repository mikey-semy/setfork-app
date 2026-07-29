import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

// Линза 02, F3: «жёсткий backstop на ЕДИНОЙ write-точке версий» (list-store.ts:52-64).
// Здесь — TS-половина контраста: тот же список, та же операция, но через listStore.
// Rust-половина проверена вживую (git push через ядро создал версию 2 в замороженном
// списке) — см. реестр; воспроизведение: scripts/lens02-git-bridge.ts.

const { db, users, templates, templateVersions, steps } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')

let tplId = ''

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'frzowner2' }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'frozen-2', title: { en: 'F' }, desc: {}, tags: [], currentVersion: 1, frozenAt: new Date() })
    .returning({ id: templates.id })
  tplId = t.id
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'seed', authorId: u.id })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: 'S' }, desc: {} })
})

describe('заморозка на TS-пути записи', () => {
  it('listStore.addVersion в замороженный список бросает', async () => {
    await expect(
      listStore.addVersion(tplId, { note: 'через listStore', authorId: null, steps: [] } as never),
    ).rejects.toThrow(/frozen/i)
  })

  it('и версия действительно не появилась', async () => {
    const vs = await db.select().from(templateVersions).where(eq(templateVersions.templateId, tplId))
    expect(vs).toHaveLength(1)
  })
})
