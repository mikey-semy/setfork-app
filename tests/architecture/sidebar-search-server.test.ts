import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⚠️ ПОЛЕ ПОИСКА В РЕЙКЕ ИЩЕТ НА СЕРВЕРЕ, А НЕ СРЕДИ ЗАГРУЖЕННЫХ СТРОК.
 *
 * В боковом меню лежат последние SIDEBAR_LISTS списков, и поле без `remoteSearch`
 * фильтрует ровно их: список, не попавший в недавние, получает «Ничего не найдено»,
 * хотя прекрасно находится обычным поиском. Владелец поймал это на «Гно» 02.09.2026.
 *
 * Проверка смотрит на КОД: поведение панели уже покрыто своими тестами
 * (tests/widgets/lists-panel), а здесь стережётся ПРОВОДКА — единственное, что
 * отличало рабочее поле от нерабочего.
 */
const src = readFileSync(new URL('../../src/widgets/Sidebar.tsx', import.meta.url).pathname, 'utf8')

describe('поиск в боковом меню', () => {
  it('подключён к серверному поиску', () => {
    expect(src, 'без remoteSearch поле фильтрует только показанное').toMatch(/remoteSearch=\{/)
  })

  it('поле вообще показано — иначе искать негде', () => {
    expect(src).toMatch(/\n\s+searchable\n/)
  })
})
