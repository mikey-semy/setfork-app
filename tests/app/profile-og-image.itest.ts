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

const { db, users } = await import('@/shared/db')
const { generateMetadata } = await import('@/app/[handle]/page')
const { SITE_OG_IMAGE } = await import('@/shared/seo/page-meta')

const meta = async (handle: string) =>
  (await generateMetadata({ params: Promise.resolve({ handle }), searchParams: Promise.resolve({}) })) as {
    openGraph?: { images?: { url: string }[] }
    twitter?: { images?: { url: string }[]; card?: string }
  }

beforeAll(async () => {
  await resetTables([users])
  await db.insert(users).values([
    { handle: 'with-avatar', avatarUrl: 'https://avatars.example.org/u/1.png' },
    { handle: 'no-avatar' },
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
})
