import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESERVED_TOP } from '@/shared/nav/reserved-top'

/**
 * RESERVED_TOP обязан покрывать ВСЕ корневые сегменты src/app: чего в нём нет,
 * шапка рисует как профиль пользователя («SF guilds» — находка линзы 07).
 * Список — код, маршруты — файловая система; этот тест и есть их синхрон.
 */
describe('RESERVED_TOP ↔ src/app', () => {
  const appDir = join(__dirname, '../../../src/app')
  const topSegments = readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('_'))
    .map((d) => d.name)

  it('каждый корневой каталог app перечислен в RESERVED_TOP', () => {
    const missing = topSegments.filter((s) => !RESERVED_TOP.has(s))
    expect(missing, `добавь в shared/nav/reserved-top.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('в RESERVED_TOP нет мёртвых сегментов без каталога', () => {
    const dead = [...RESERVED_TOP].filter((s) => !topSegments.includes(s))
    expect(dead, `в src/app больше нет: ${dead.join(', ')}`).toEqual([])
  })
})
