import { describe, expect, it } from 'vitest'
import { tr, trWithLang } from '@/shared/i18n'

/**
 * `trWithLang` — то же правило подстановки, что у `tr`, плюс ключ, которым текст взят.
 * Правило одно: `tr` построен поверх него, и расхождение сломало бы оба.
 */
describe('trWithLang', () => {
  it.each([
    [{ ru: 'Суп', en: 'Soup' }, 'ru', 'Суп', 'ru'],
    [{ ru: 'Суп', en: 'Soup' }, 'en', 'Soup', 'en'],
    [{ ru: 'Суп' }, 'en', 'Суп', 'ru'],
    [{ de: 'Suppe', en: 'Soup' }, 'ru', 'Soup', 'en'],
    [{ de: 'Suppe' }, 'ru', 'Suppe', 'de'],
    // Пустая строка — не перевод: берётся следующий.
    [{ ru: '', en: 'Soak gelatin' }, 'ru', 'Soak gelatin', 'en'],
  ] as const)('%j при %s → «%s» (%s)', (text, lang, want, key) => {
    expect(trWithLang(text, lang)).toEqual({ text: want, lang: key })
    expect(tr(text, lang)).toBe(want)
  })

  it('текста нет — пусто и без языка', () => {
    expect(trWithLang(null, 'ru')).toEqual({ text: '', lang: null })
    expect(trWithLang({}, 'ru')).toEqual({ text: '', lang: null })
    expect(trWithLang({ ru: '' }, 'ru')).toEqual({ text: '', lang: null })
  })
})
