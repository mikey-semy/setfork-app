import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * `/api/landing` на настоящей базе: без правок — пустой `content` (лендинг рисует свой
 * словарь), с правками — ровно они, без `heroImage` и подмешанных счётчиков.
 */
// Экшен админки: права админа и сброс кэша страниц — не предмет этих тестов.
vi.mock('@/shared/auth/admin', async (orig) => ({ ...(await orig()), requireAdmin: async () => ({ userId: 'admin', handle: 'admin' }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { db, appSettings } = await import('@/shared/db')
const { saveLanding } = await import('@/features/admin/landing-actions')
const { GET } = await import('@/app/api/landing/route')
const { saveLandingOverrides } = await import('@/shared/settings/landing')

const call = async () => (await GET()).json() as Promise<{ content: Record<string, Record<string, unknown>>; featured: unknown[] }>

beforeEach(async () => {
  await resetTables([appSettings])
})

describe('/api/landing', () => {
  it('ничего не сохранено — content пуст: никаких умолчаний старого лендинга', async () => {
    const body = await call()
    expect(body.content).toEqual({})
    expect(Array.isArray(body.featured)).toBe(true)
  })

  it('сохранённое — ровно оно; heroImage и чужие ключи не уходят', async () => {
    await saveLandingOverrides({ en: { texts: { heroTitle: 'Runnable lists' }, stats: [{ num: 'MCP', label: 'agent-ready', source: 'server-info.ts' }] } })
    const body = await call()
    expect(body.content).toEqual({ en: { heroTitle: 'Runnable lists', stats: [{ num: 'MCP', label: 'agent-ready' }] } })
    expect(JSON.stringify(body)).not.toContain('heroImage')
  })

  it('сохранили пустое — ключ удалён, лендинг целиком на своём словаре', async () => {
    await saveLandingOverrides({ en: { texts: { heroTitle: 'x' } } })
    await saveLandingOverrides({ en: { texts: { heroTitle: '' } } })
    expect(await db.select().from(appSettings).where(eq(appSettings.key, 'landing.content'))).toHaveLength(0)
    expect((await call()).content).toEqual({})
  })

  it('экшен админки: плитка без источника — отказ с названием, ничего не сохранено', async () => {
    const r = await saveLanding({ ru: { texts: { heroTitle: 'Новый' }, stats: [{ num: '120', label: 'списков', source: '' }] } })
    expect(r).toEqual({ error: expect.stringContaining('ru.stats[1]') })
    expect(await db.select().from(appSettings).where(eq(appSettings.key, 'landing.content'))).toHaveLength(0)
  })

  it('экшен админки: корректное — сохранено и уходит лендингу', async () => {
    expect(await saveLanding({ ru: { texts: { heroTitle: 'Новый' } } })).toEqual({ ok: true })
    expect((await call()).content).toEqual({ ru: { heroTitle: 'Новый' } })
  })
})
