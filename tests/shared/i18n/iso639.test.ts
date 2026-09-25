import { describe, expect, it } from 'vitest'
import { ISO_639_1, isContentLang } from '@/shared/i18n/iso639'

/**
 * Перечень языков содержимого — стандарт ISO 639-1, а не наша выдумка. Проверяем стандартом же:
 * у каждого кода есть имя в `Intl.DisplayNames` (голый код вместо имени значит опечатку или
 * устаревший код), повторов нет.
 */
describe('ISO 639-1', () => {
  it('коды уникальны, двухбуквенные, у каждого есть имя языка', () => {
    expect(new Set(ISO_639_1).size).toBe(ISO_639_1.length)
    const names = new Intl.DisplayNames(['en'], { type: 'language' })
    const unnamed = ISO_639_1.filter((c) => !/^[a-z]{2}$/.test(c) || names.of(c) === c)
    expect(unnamed).toEqual([])
  })

  it('языки интерфейса и соседние — есть, выдуманных и устаревших — нет', () => {
    for (const code of ['en', 'ru', 'uk', 'be', 'kk', 'de']) expect(isContentLang(code), code).toBe(true)
    for (const code of ['xx', 'russian', 'iw', 'EN', '', null, 1]) expect(isContentLang(code), String(code)).toBe(false)
  })
})
