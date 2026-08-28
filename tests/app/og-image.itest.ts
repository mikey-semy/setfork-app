import { writeFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import Image, { publicList } from '@/app/[handle]/[slug]/opengraph-image'
import { db, steps, templates, templateVersions, users } from '@/shared/db'

/**
 * Адрес картинки-превью открыт всем и без сессии. Поэтому проверяется не «рисуется
 * ли PNG», а что в него попадает: заголовок ЧУЖОГО черновика в превью — это утечка,
 * для которой достаточно угадать адрес.
 */
const OWNER = 'og-owner'
const ctx: Record<string, string> = {}

async function makeList(slug: string, patch: Partial<typeof templates.$inferInsert> = {}, blocks = 3) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: `title of ${slug}` }, desc: { en: 'why this list exists' }, ...patch })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  for (let n = 1; n <= blocks; n++) {
    await db.insert(steps).values({ versionId: v.id, n, type: 'step', content: {}, title: { en: `step ${n}` } })
  }
  return t.id
}

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  const [o] = await db.insert(users).values({ handle: OWNER, name: 'Owner Name' }).returning({ id: users.id })
  ctx.owner = o.id
})

describe('картинка списка для превью', () => {
  it('публичный список отдаёт свои данные: автор, число блоков, версия', async () => {
    await makeList('og-public', { tags: ['devops', 'migration'] }, 12)

    const row = await publicList(OWNER, 'og-public')

    expect(row?.ownerName).toBe('Owner Name')
    expect(row?.blocks).toBe(12)
    expect(row?.currentVersion).toBe(1)
    expect(row?.tags).toEqual(['devops', 'migration'])
  })

  it('черновик, приватный и снятый модерацией в картинку не попадают', async () => {
    await makeList('og-draft', { status: 'draft' })
    await makeList('og-private', { visibility: 'private' })
    await makeList('og-pending', { moderation: 'pending' })

    expect(await publicList(OWNER, 'og-draft')).toBeNull()
    expect(await publicList(OWNER, 'og-private')).toBeNull()
    expect(await publicList(OWNER, 'og-pending')).toBeNull()
  })

  it('рисуется PNG заявленного размера — и для несуществующего адреса тоже', async () => {
    await makeList('og-public', { tags: ['devops', 'migration', 'caddy'] }, 12)

    for (const slug of ['og-public', 'no-such-list']) {
      const res = await Image({ params: Promise.resolve({ handle: OWNER, slug }) })
      const bytes = Buffer.from(await res.arrayBuffer())

      // Сигнатура PNG: картинка действительно отрисована, а не отдана заглушкой.
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      expect(bytes.length).toBeGreaterThan(1000)
      if (process.env.OG_PROBE_OUT) await writeFile(`${process.env.OG_PROBE_OUT}/og-${slug}.png`, bytes)
    }
  })
})
