import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATS_MIN_LISTS, statsFrom } from '@/features/landing/stats'

/**
 * ⚠️ ЧИСЛА НА ВИТРИНЕ — СЧИТАННЫЕ ИЛИ НИКАКИЕ.
 *
 * До 02.09.2026 лендинг обещал «12k+ публичных списков», «48k+ улучшений», «2.3k+
 * авторов». Это были не устаревшие данные: таких величин никогда не существовало —
 * живой корпус на тот день составлял 24 публичных списка.
 */
const LABELS: [string, string, string] = ['списков', 'улучшений', 'авторов']

describe('числа лендинга', () => {
  it('малый корпус не показывается вовсе: пустой слот честнее выдуманного', () => {
    expect(statsFrom({ lists: 24, contributions: 3, makers: 5 }, LABELS)).toEqual([])
    expect(statsFrom({ lists: STATS_MIN_LISTS - 1, contributions: 999, makers: 999 }, LABELS)).toEqual([])
  })

  it('на пороге и выше показываются НАСТОЯЩИЕ числа, без «+» и «k»', () => {
    const out = statsFrom({ lists: STATS_MIN_LISTS, contributions: 42, makers: 17 }, LABELS)
    expect(out.map((s) => s.num)).toEqual([String(STATS_MIN_LISTS), '42', '17'])
    for (const s of out) {
      expect(s.num, 'округление вверх на малых значениях и есть тот самый обман').not.toMatch(/[k+]/)
    }
  })

  it('нулевая плитка не показывается: она говорит только «здесь пусто»', () => {
    const out = statsFrom({ lists: STATS_MIN_LISTS + 13, contributions: 0, makers: 1 }, LABELS)
    expect(out.map((s) => s.label)).toEqual(['списков', 'авторов'])
  })

  it('в дефолтах лендинга не осталось чисел, вписанных руками', () => {
    const src = readFileSync(new URL('../../../src/shared/settings/landing.ts', import.meta.url).pathname, 'utf8')
    const stats = [...src.matchAll(/num: '([^']+)'/g)].map((m) => m[1])
    expect(stats.length, 'плитки исчезли совсем — проверка потеряла предмет').toBeGreaterThan(0)
    for (const num of stats) {
      expect(num, `«${num}» вписано руками: числа считаются по базе`).not.toMatch(/\d/)
    }
  })
})
