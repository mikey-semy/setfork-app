import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../helpers/reset-db'

/**
 * У КАРТОЧКИ ПРОФИЛЯ ЕСТЬ КАРТИНКА: аватар, без него — общесайтовая.
 *
 * Профиль объявляет свой `openGraph`, а Next сливает метаданные ПОВЕРХНОСТНО — картинка
 * из корневого макета до страницы не доезжала: ссылка на профиль в мессенджере
 * разворачивалась без картинки (ревью соответствия 23.09).
 */
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => null }))

const { db, appSettings, users } = await import('@/shared/db')
const { clearMediaCache, MEDIA_KEYS } = await import('@/shared/settings/media')
const { generateMetadata } = await import('@/app/[handle]/page')
const { SITE_OG_IMAGE } = await import('@/shared/seo/page-meta')

const meta = async (handle: string) =>
  (await generateMetadata({ params: Promise.resolve({ handle }), searchParams: Promise.resolve({}) })) as {
    openGraph?: { images?: { url: string }[] }
    twitter?: { images?: { url: string }[]; card?: string }
  }

beforeAll(async () => {
  await resetTables([appSettings, users])
  clearMediaCache()
  await db.insert(users).values([
    { handle: 'with-avatar', avatarUrl: 'https://avatars.example.org/u/1.png' },
    { handle: 'no-avatar' },
    // Загруженный аватар: в базе КЛЮЧ хранилища, а не адрес.
    { handle: 'stored-avatar', avatarUrl: 'avatars/u1/x.webp' },
    // Без S3 — путь на своём хосте.
    { handle: 'local-avatar', avatarUrl: '/uploads/avatars/x.webp' },
    { handle: 'private-avatar', avatarUrl: 'https://avatars.example.org/u/2.png', profilePrivate: true },
  ])
})

describe('og:image профиля', () => {
  it('аватар — в og и в twitter', async () => {
    const m = await meta('with-avatar')
    expect(m.openGraph?.images?.[0]?.url).toBe('https://avatars.example.org/u/1.png')
    expect(m.twitter?.images?.[0]?.url).toBe('https://avatars.example.org/u/1.png')
    expect(m.twitter?.card).toBe('summary')
  })

  it('без аватара — общесайтовая картинка, а не пусто', async () => {
    const m = await meta('no-avatar')
    expect(m.openGraph?.images?.[0]?.url).toBe(SITE_OG_IMAGE)
    expect(m.twitter?.images?.[0]?.url).toBe(SITE_OG_IMAGE)
  })

  it('ключ хранилища — не адрес: без imgproxy берётся общесайтовая, а не битая ссылка из ключа', async () => {
    const m = await meta('stored-avatar')
    expect(m.openGraph?.images?.[0]?.url).toBe(SITE_OG_IMAGE)
    expect(JSON.stringify(m)).not.toContain('avatars/u1/x.webp')
  })

  it('ключ хранилища при imgproxy — подписанный адрес картинки, как на самой странице', async () => {
    await db.insert(appSettings).values([
      { key: MEDIA_KEYS.useImgproxy, value: 'true' },
      { key: MEDIA_KEYS.imgproxyUrl, value: 'https://img.example.org' },
      { key: MEDIA_KEYS.s3Bucket, value: 'bucket' },
    ])
    clearMediaCache()
    try {
      const url = (await meta('stored-avatar')).openGraph?.images?.[0]?.url ?? ''
      expect(url.startsWith('https://img.example.org/')).toBe(true)
      expect(url).toContain('rs:fill:400:400')
    } finally {
      await resetTables([appSettings])
      clearMediaCache()
    }
  })

  it('путь на своём хосте — как есть (Next достроит его от metadataBase)', async () => {
    expect((await meta('local-avatar')).openGraph?.images?.[0]?.url).toBe('/uploads/avatars/x.webp')
  })

  it('приватный профиль — чужому ни картинки, ни карточки', async () => {
    const m = await meta('private-avatar')
    expect(m.openGraph).toBeUndefined()
    expect(JSON.stringify(m)).not.toContain('avatars.example.org/u/2')
  })
})
