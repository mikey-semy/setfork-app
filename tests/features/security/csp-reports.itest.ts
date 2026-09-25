import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * СВОДКА НАРУШЕНИЙ CSP НА НАСТОЯЩЕЙ БАЗЕ: вид считается, а не множится; на потолке
 * новые виды не пишутся, известные — считаются дальше.
 */
const { db, cspReports } = await import('@/shared/db')
const { recordCspViolation, MAX_DISTINCT } = await import('@/features/security/csp-reports')
type V = Parameters<typeof recordCspViolation>[0]

const v = (blocked: string, path = '/a', line: number | null = 1): V => ({ directive: 'script-src-elem', blocked, source: '', path, line })

beforeEach(async () => {
  await resetTables([cspReports])
})

describe('сводка нарушений CSP', () => {
  it('повтор вида — счётчик и свежий пример, а не новая строка', async () => {
    await recordCspViolation(v('inline', '/a', 1))
    await recordCspViolation(v('inline', '/b', 7))
    const rows = await db.select().from(cspReports)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ count: 2, samplePath: '/b', sampleLine: 7 })
  })

  it('⚠️ на потолке новый вид не пишется, известный — считается', async () => {
    const filler = Array.from({ length: MAX_DISTINCT }, (_, i) => ({
      key: `k${i}`,
      directive: 'script-src-elem',
      blocked: `https://x.example/${i}.js`,
      source: '',
      samplePath: '/',
    }))
    await db.insert(cspReports).values(filler.slice(0, MAX_DISTINCT - 1))
    await recordCspViolation(v('inline'))
    await recordCspViolation(v('eval'))
    await recordCspViolation(v('inline'))
    const rows = await db.select().from(cspReports)
    expect(rows).toHaveLength(MAX_DISTINCT)
    expect(rows.find((r) => r.blocked === 'inline')?.count).toBe(2)
    expect(rows.some((r) => r.blocked === 'eval')).toBe(false)
  })
})
