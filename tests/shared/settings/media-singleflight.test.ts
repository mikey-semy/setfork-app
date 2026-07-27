import { describe, it, expect, vi, beforeEach } from 'vitest'

// Считаем РЕАЛЬНЫЕ обращения к БД: одновременные вызовы должны схлопнуться в один.
const selectCalls = vi.fn()

vi.mock('@/shared/db', () => ({
  appSettings: { key: 'key' },
  db: {
    select: () => {
      selectCalls()
      return {
        from: () => ({
          // Небольшая задержка — иначе «одновременность» была бы фиктивной.
          where: () => new Promise((resolve) => setTimeout(() => resolve([]), 20)),
        }),
      }
    },
  },
}))
vi.mock('drizzle-orm', () => ({ inArray: () => ({}) }))

describe('getMediaSettings — single-flight', () => {
  beforeEach(async () => {
    selectCalls.mockClear()
    const { clearMediaCache } = await import('@/shared/settings/media')
    clearMediaCache()
  })

  it('десять одновременных вызовов на холодном кэше дают ОДИН запрос', async () => {
    const { getMediaSettings } = await import('@/shared/settings/media')
    await Promise.all(Array.from({ length: 10 }, () => getMediaSettings()))
    expect(selectCalls).toHaveBeenCalledTimes(1)
  })

  it('после заполнения кэша запросов больше нет', async () => {
    const { getMediaSettings } = await import('@/shared/settings/media')
    await getMediaSettings()
    selectCalls.mockClear()
    await Promise.all([getMediaSettings(), getMediaSettings()])
    expect(selectCalls).not.toHaveBeenCalled()
  })

  it('сброс кэша снова разрешает ровно один запрос', async () => {
    const { getMediaSettings, clearMediaCache } = await import('@/shared/settings/media')
    await getMediaSettings()
    clearMediaCache()
    selectCalls.mockClear()
    await Promise.all([getMediaSettings(), getMediaSettings(), getMediaSettings()])
    expect(selectCalls).toHaveBeenCalledTimes(1)
  })
})
