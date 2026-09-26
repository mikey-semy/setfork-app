import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { pickListLang } = await import('@/features/library/list-store')

/**
 * Правило языка нового списка (ADR-0030) — таблицей, без ядра: известный язык содержимого →
 * запасной вариант; копия — только содержимое; не ISO — пусто.
 */
describe('pickListLang', () => {
  it.each([
    [{ lang: 'ru', fallback: 'en' }, 'ru'],
    [{ fallback: 'ru' }, 'ru'],
    [{ lang: 'russian', fallback: 'en' }, 'en'],
    [{ lang: null, fromContent: true, fallback: 'ru' }, null],
    [{ lang: 'de', fromContent: true }, 'de'],
    [{}, null],
  ] as const)('%j → %s', (input, want) => {
    expect(pickListLang(input)).toBe(want)
  })
})
