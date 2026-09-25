import { describe, expect, it } from 'vitest'
import { creativeWork, howTo, itemList } from '@/shared/seo/jsonld'
import { servedLang } from '@/shared/i18n'

/**
 * ЯЗЫК СТРАНИЦЫ ДЛЯ ПОИСКОВИКА — ЯЗЫК ЕЁ СОДЕРЖИМОГО (ADR-0029).
 *
 * Языка в адресе нет, и робот без `Accept-Language` видит английскую обвязку. Русский
 * список обязан объявлять себя русским сам: `inLanguage` в разметке — язык ТЕКСТА,
 * взятый тем же `servedLang`, что метит `data.json` и встраивание.
 */
const ruOnly = { title: { ru: 'Гороховый суп' } }
const both = { title: { ru: 'Гороховый суп', en: 'Pea soup' } }

describe('inLanguage в разметке списка', () => {
  it('русский список без перевода при английском интерфейсе — ru', () => {
    const lang = servedLang(ruOnly.title, 'en')
    expect(lang).toBe('ru')
    expect(creativeWork({ name: 'x', path: '/a/b', authorName: 'a', authorPath: '/a', inLanguage: lang })).toMatchObject({ inLanguage: 'ru' })
    expect(howTo({ name: 'x', path: '/a/b', steps: [], inLanguage: lang })).toMatchObject({ inLanguage: 'ru' })
    expect(itemList('x', [], lang)).toMatchObject({ inLanguage: 'ru' })
  })

  it('перевод есть — язык интерфейса', () => {
    expect(servedLang(both.title, 'en')).toBe('en')
  })

  it('без языка поле не появляется — пустое значение хуже отсутствия', () => {
    expect(creativeWork({ name: 'x', path: '/a/b', authorName: 'a', authorPath: '/a' })).not.toHaveProperty('inLanguage')
    expect(itemList('x', [])).not.toHaveProperty('inLanguage')
  })
})
