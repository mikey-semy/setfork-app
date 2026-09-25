import { describe, expect, it } from 'vitest'
import { LANDING_KEYS, landingApiContent, sanitizeOverrides } from '@/shared/settings/landing'

/**
 * ПРАВКИ ЛЕНДИНГА — ТОЛЬКО СОХРАНЁННОЕ.
 *
 * `/api/landing` отдавал умолчания СТАРОГО лендинга как правки из админки: новый лендинг
 * кладёт любую строку поверх своего словаря и показал бы «Lists that get» вместо своих
 * текстов, хотя в админке никто ничего не сохранял (25.09).
 */
describe('правки лендинга', () => {
  it('ничего не сохранено — лендингу не уходит ни одной строки', () => {
    expect(landingApiContent(sanitizeOverrides(null))).toEqual({})
  })

  it('старый формат: знакомые строки остаются, чужие ключи и числа без источника — нет', () => {
    const old = {
      en: {
        heroTitle: 'Lists that get',
        heroTitleAccent: 'better together.',
        stats: [{ num: '12k+', label: 'public lists' }],
        footerNote: '   ',
      },
      heroImage: 'landing/x.png',
    }
    const o = sanitizeOverrides(old)
    expect(o.en.texts).toEqual({ heroTitle: 'Lists that get' })
    expect(o.en.stats).toEqual([])
    expect(landingApiContent(o)).toEqual({ en: { heroTitle: 'Lists that get' } })
  })

  it('число — только с источником, и наружу без него', () => {
    const o = sanitizeOverrides({
      ru: { stats: [{ num: '120', label: 'списков', source: 'SELECT count(*) … на 25.09' }, { num: '9k', label: 'правок', source: '' }] },
    })
    expect(o.ru.stats).toHaveLength(1)
    expect(landingApiContent(o)).toEqual({ ru: { stats: [{ num: '120', label: 'списков' }] } })
  })

  it('форма редактора (texts) и форма хранилища (строки у языка) читаются одинаково', () => {
    expect(sanitizeOverrides({ en: { texts: { ctaTitle: 'Go' } } })).toEqual(sanitizeOverrides({ en: { ctaTitle: 'Go' } }))
  })

  it('перечень ключей — без повторов и без ключей старого лендинга', () => {
    expect(new Set(LANDING_KEYS).size).toBe(LANDING_KEYS.length)
    for (const old of ['heroTitleAccent', 'heroCaption', 'councilTitle', 'heroImage']) expect(LANDING_KEYS as readonly string[]).not.toContain(old)
  })
})
