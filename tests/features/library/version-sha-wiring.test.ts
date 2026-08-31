import { describe, expect, it, vi } from 'vitest'

/**
 * ПОДПИСЬ ВЕРСИИ БЕРЁТСЯ У ЯДРА — проверка ПОДКЛЮЧЕНИЯ, а не форматирования.
 *
 * ⚠️ Прежние тесты гоняли `toMarkdown` на рукотворном объекте: они были зелёные, пока
 * фича была МЕРТВА. SHA читался через фасад чтений, а тот уходит в ядро только при
 * `SETFORK_DOMAIN_READS=1` — флага нет ни в одном compose и ни в одном `.env`, значит
 * отвечал Drizzle-адаптер, который ставит `commitSha: null` (колонки в схеме нет).
 * Поверхность существовала, значение было пустым всегда.
 *
 * Поэтому здесь проверяется путь: спросили ядро — получили подпись; ядро молчит —
 * получили пусто и НЕ уронили страницу.
 */
const h = vi.hoisted(() => ({ versions: [] as { version: number; commitSha: string | null }[], fail: false }))

vi.mock('@/features/library/list-store.remote', () => ({
  listReadRemote: {
    listVersions: async () => {
      if (h.fail) throw new Error('core unavailable')
      return h.versions
    },
  },
}))

describe('подпись версии', () => {
  it('приходит из ядра, а не из проекции', async () => {
    process.env.SETFORK_CORE_URL = '1'
    h.fail = false
    h.versions = [
      { version: 2, commitSha: 'a1b2c3d4e5f6' },
      { version: 1, commitSha: null },
    ]
    const { versionShaMap } = await import('@/features/library/version-sha')
    const map = await versionShaMap('list-1')

    expect(map.get(2), 'подпись версии обязана доехать от ядра').toBe('a1b2c3d4e5f6')
    expect(map.has(1), 'версия без тега подписи не получает — и это законно').toBe(false)
  })

  it('ядро молчит — пусто, а не пятисотка', async () => {
    process.env.SETFORK_CORE_URL = '1'
    h.fail = true
    const { versionShaMap } = await import('@/features/library/version-sha')
    await expect(versionShaMap('list-1')).resolves.toBeInstanceOf(Map)
    expect((await versionShaMap('list-1')).size, 'отказ ядра не должен ронять историю').toBe(0)
  })

  it('ядра нет в конфигурации — не ходим никуда', async () => {
    delete process.env.SETFORK_CORE_URL
    h.fail = true // если пойдём — упадём, значит проверка настоящая
    const { versionShaMap } = await import('@/features/library/version-sha')
    expect((await versionShaMap('list-1')).size).toBe(0)
  })
})
