import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * PUSH ЧЕРЕЗ GIT НЕ СТИРАЕТ ИДЕНТИЧНОСТЬ БЛОКОВ.
 *
 * `bundle.ts` отдаёт `blockId` в list.json (ADR-0013), а проекция запушенного коммита
 * его не читала — значит ЛЮБОЙ push, даже правка одной запятой, записывал новой версии
 * `block_id = null` всем блокам сразу. Вместе с идентичностью отваливались якоря
 * комментариев к пунктам, а дифф и бандл откатывались на сопоставление по заголовку
 * (P1 из авто-ревью #485).
 *
 * Проверяем на живом git и живой БД: идентичность из list.json доезжает до steps,
 * мусор в поле не роняет проекцию, а повтор одного id не создаёт двойника.
 */
const exec = promisify(execFile)

const { db, steps, templates, templateVersions, users } = await import('@/shared/db')
const { projectPushedCommit } = await import('@/features/git/project')

const dirs: string[] = []
let templateId = ''

const BLOCK_A = '11111111-2222-3333-4444-555555555555'
const BLOCK_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** Bare-репо с одним коммитом, где list.json — ровно переданный объект. */
async function bareWithList(list: unknown): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'sf-work-'))
  const bare = await mkdtemp(join(tmpdir(), 'sf-bare-'))
  dirs.push(work, bare)
  await exec('git', ['init', '--bare', '--initial-branch=main', bare])
  await exec('git', ['init', '--initial-branch=main', work])
  await exec('git', ['-C', work, 'config', 'user.email', 'test@example.com'])
  await exec('git', ['-C', work, 'config', 'user.name', 'Test'])
  await writeFile(join(work, 'list.json'), JSON.stringify(list, null, 2), 'utf8')
  await exec('git', ['-C', work, 'add', 'list.json'])
  await exec('git', ['-C', work, 'commit', '-m', 'v2: правка через git'])
  await exec('git', ['-C', work, 'push', bare, 'main'])
  return bare
}

const stepRows = async (version: number) => {
  const [v] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(templateVersions.version)
    .offset(version - 1)
    .limit(1)
  return db.select({ n: steps.n, blockId: steps.blockId, title: steps.title }).from(steps).where(eq(steps.versionId, v.id)).orderBy(steps.n)
}

beforeEach(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'push-owner' }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'push-list', title: { en: 'Push list' }, currentVersion: 1 })
    .returning({ id: templates.id })
  templateId = t.id
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'seed', authorId: u.id })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values([
    { versionId: v.id, n: 1, blockId: BLOCK_A, title: { en: 'Step one' }, desc: {} },
    { versionId: v.id, n: 2, blockId: BLOCK_B, title: { en: 'Step two' }, desc: {} },
  ])
})

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
})

describe('проекция push', () => {
  it('blockId из list.json доезжает до новой версии', async () => {
    const bare = await bareWithList({
      title: 'Push list',
      steps: [
        { blockId: BLOCK_A, title: 'Step one (правка)', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
        { blockId: BLOCK_B, title: 'Step two', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
      ],
    })
    expect(await projectPushedCommit(templateId, bare)).toBe(2)
    const rows = await stepRows(2)
    expect(rows.map((r) => r.blockId)).toEqual([BLOCK_A, BLOCK_B])
  })

  it('мусор вместо uuid не роняет проекцию — просто нет идентичности', async () => {
    const bare = await bareWithList({
      steps: [
        { blockId: 'не-uuid', title: 'Step one', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
        { blockId: BLOCK_B, title: 'Step two', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
      ],
    })
    expect(await projectPushedCommit(templateId, bare)).toBe(2)
    expect((await stepRows(2)).map((r) => r.blockId)).toEqual([null, BLOCK_B])
  })

  it('один id на двух блоках — двойника не создаём', async () => {
    const bare = await bareWithList({
      steps: [
        { blockId: BLOCK_A, title: 'Step one', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
        { blockId: BLOCK_A, title: 'Копия', desc: '', command: '', level: 'required', why: '', section: '', subtasks: [], refs: [] },
      ],
    })
    expect(await projectPushedCommit(templateId, bare)).toBe(2)
    expect((await stepRows(2)).map((r) => r.blockId)).toEqual([BLOCK_A, null])
  })
})
