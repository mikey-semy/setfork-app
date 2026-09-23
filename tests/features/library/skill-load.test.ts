import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * АВТОРСКИЕ ФАЙЛЫ ЭКСПОРТА СКИЛЛА — МЯГКО, НО НЕ МОЛЧА.
 *
 * Ядро не настроено, старое или упало — человек всё равно получает скилл, собранный из
 * блоков (так же, как подпись версии не роняет экспорт). Но сбой обязан уйти в журнал:
 * иначе «архив без скриптов автора» выглядел бы нормой, и никто бы не узнал, что ядро
 * не ответило.
 */
const h = vi.hoisted(() => ({ captured: [] as unknown[] }))

vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))
vi.mock('@/features/library/guard', () => ({
  requireViewableDetail: async () => ({
    tpl: { id: 't1', currentVersion: 4, title: { en: 'T' }, desc: {}, tags: [], ordered: true, slug: 's', owner: { handle: 'o' } },
    currentVersion: { id: 'v4', version: 4, verificationLevel: 'rock' },
    steps: [],
  }),
}))
vi.mock('@/features/library/version-sha', () => ({ versionShaMap: async () => new Map() }))
vi.mock('@/features/library/verification-report', () => ({ latestReport: async () => null }))
vi.mock('@/shared/observability', () => ({ captureError: (e: unknown) => h.captured.push(e), log: { warn: () => {} } }))

const { loadSkill } = await import('@/features/library/skill-load')

const file = { path: 'scripts/run.sh', content: new Uint8Array([101]), executable: true }

describe('авторские файлы при загрузке скилла', () => {
  beforeEach(() => {
    h.captured = []
    process.env.SETFORK_CORE_URL = '1'
  })
  afterEach(() => {
    delete process.env.SETFORK_CORE_URL
  })

  it('ядро ответило — файлы доезжают до сборщика, спрошена ТЕКУЩАЯ версия', async () => {
    const asked: number[] = []
    const loaded = await loadSkill('o', 's', { authoredFiles: async (_r, v) => (asked.push(v), [file]) })
    expect(loaded?.ctx.authored).toEqual([file])
    expect(asked, 'спросили не ту версию — архив отдал бы чужие байты').toEqual([4])
  })

  it('⚠️ ядро упало — скилл всё равно собирается, а сбой уходит в журнал', async () => {
    const loaded = await loadSkill('o', 's', { authoredFiles: async () => { throw new Error('core down') } })
    expect(loaded, 'сбой ядра лишил человека файла').not.toBeNull()
    expect(loaded?.ctx.authored).toBeNull()
    expect(h.captured, 'сбой проглочен молча').toHaveLength(1)
  })

  it('ядро не настроено — его не спрашивают вовсе', async () => {
    delete process.env.SETFORK_CORE_URL
    let called = false
    await loadSkill('o', 's', { authoredFiles: async () => ((called = true), [file]) })
    expect(called).toBe(false)
  })
})
