import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { pickListLang } = await import('@/features/library/list-store')

/**
 * Правило языка нового списка (ADR-0030) — таблицей, без ядра: известный язык содержимого →
 * настройка автора → запасной вариант; копия — только содержимое; не ISO — пусто.
 */
describe('pickListLang', () => {
  it.each([
    [{ lang: 'ru', setting: 'be', fallback: 'en' }, 'ru'],
    [{ setting: 'be', fallback: 'ru' }, 'be'],
    [{ fallback: 'ru' }, 'ru'],
    [{ lang: 'russian', setting: 'xx', fallback: 'en' }, 'en'],
    [{ lang: null, fromContent: true, setting: 'be', fallback: 'ru' }, null],
    [{ lang: 'de', fromContent: true, setting: 'be' }, 'de'],
    [{}, null],
  ] as const)('%j → %s', (input, want) => {
    expect(pickListLang(input)).toBe(want)
  })
})
