import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОСЛЕДНИЙ РЕЛИЗ — новейший НЕ пред-релиз (как «Latest» у GitHub). Одно правило на
 * метку в каталоге релизов и на версию скилла в сводке списка.
 */
const { db, releases, templates, users } = await import('@/shared/db')
const { getLatestRelease, getLatestReleaseId } = await import('@/features/releases/queries')

let tplId = ''
let authorId = ''

beforeEach(async () => {
  await resetTables([releases, templates, users])
  const [u] = await db.insert(users).values({ handle: 'lr-owner' }).returning({ id: users.id })
  authorId = u.id
  const [t] = await db.insert(templates).values({ ownerId: u.id, slug: 'kit', title: { en: 'kit' }, isSkill: true, currentVersion: 6 }).returning({ id: templates.id })
  tplId = t.id
})

const rel = (tag: string, version: number, minutesAgo: number, prerelease = false) =>
  db.insert(releases).values({ templateId: tplId, tag, version, prerelease, authorId, createdAt: new Date(Date.now() - minutesAgo * 60_000) })

describe('getLatestRelease', () => {
  it('новейший не пред-релиз', async () => {
    await rel('v0.5.1', 3, 60)
    await rel('v0.7.0', 5, 30)
    expect(await getLatestRelease(tplId)).toMatchObject({ tag: 'v0.7.0', version: 5 })
  })

  it('пред-релиз новее — не «последний»', async () => {
    await rel('v0.7.0', 5, 30)
    await rel('v0.8.0-rc1', 6, 5, true)
    expect((await getLatestRelease(tplId))?.tag).toBe('v0.7.0')
  })

  it('каталог релизов берёт тот же релиз', async () => {
    await rel('v0.7.0', 5, 30)
    await rel('v0.8.0-rc1', 6, 5, true)
    expect(await getLatestReleaseId(tplId)).toBe((await getLatestRelease(tplId))?.id)
  })

  it('без релизов — null', async () => {
    expect(await getLatestRelease(tplId)).toBeNull()
  })
})
