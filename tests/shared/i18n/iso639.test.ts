import { describe, expect, it } from 'vitest'
import { LOCALES } from '@/shared/i18n'
import { ISO_639_1, isContentLang } from '@/shared/i18n/iso639'

/**
 * Перечень языков содержимого — стандарт ISO 639-1, а не наша выдумка. Сверяем со стандартом,
 * который знает ICU: код обязан быть КАНОНИЧЕСКИМ тегом — устаревшие `in`, `iw`, `ji`, `mo`, `sh`
 * ICU знает и называет, но канонизирует в `id`, `he`, `yi`, `ro`, `sr` (ревью по линзам: «имя есть»
 * их не отсекало). Выдуманный код ICU отдаёт голым кодом вместо имени.
 */
describe('ISO 639-1', () => {
  it('183 кода, без повторов', () => {
    expect(ISO_639_1).toHaveLength(183)
    expect(new Set(ISO_639_1).size).toBe(ISO_639_1.length)
  })

  it('каждый — канонический тег с именем языка (устаревших и выдуманных нет)', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'language' })
    // `tl` (тагальский) ICU канонизирует в `fil` (филиппинский) — это не устаревший код ISO 639-1.
    const bad = ISO_639_1.filter((c) => names.of(c) === c || (Intl.getCanonicalLocales(c)[0] !== c && c !== 'tl'))
    expect(bad).toEqual([])
  })

  it('языки интерфейса входят в языки содержимого', () => {
    for (const l of LOCALES) expect(isContentLang(l), l).toBe(true)
  })

  it('выдуманные, устаревшие и не-строки — нет', () => {
    for (const code of ['xx', 'russian', 'iw', 'in', 'EN', '', null, 1]) expect(isContentLang(code), String(code)).toBe(false)
  })
})
