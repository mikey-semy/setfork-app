import { describe, expect, it } from 'vitest'
import { LANDING_KEYS, landingApiContent, landingProblems, sanitizeOverrides } from '@/shared/settings/landing'
import { LANDING_MAX_STATS, landingMaxLength } from '@/shared/landing-keys'

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

  it('перечень ключей — без повторов, без ключей старого лендинга и без тех, что лендинг перекрывать не даёт', () => {
    expect(new Set(LANDING_KEYS).size).toBe(LANDING_KEYS.length)
    // Старый лендинг и то, что вне белого списка OVERRIDABLE нового (метаданные, бренд,
    // копирайт, служебные подписи): правка по ним «сохранилась» бы впустую.
    const forbidden = ['heroTitleAccent', 'heroCaption', 'councilTitle', 'heroImage', 'brand', 'metaTitle', 'metaDescription', 'langSwitch', 'navLabel', 'skillWindowTitle', 'gitCardTitle', 'mcpWindowTitle', 'copyright', 'stats']
    for (const key of forbidden) expect(LANDING_KEYS as readonly string[], key).not.toContain(key)
  })

  it('значения обрезаются по краям', () => {
    expect(sanitizeOverrides({ en: { heroTitle: '  Runnable  ' } }).en.texts).toEqual({ heroTitle: 'Runnable' })
  })

  it('то, что не сохранится, НАЗЫВАЕТСЯ: плитка без источника, лишняя плитка, строка сверх лимита', () => {
    expect(landingProblems({ en: { heroTitle: 'ok', stats: [{ num: '1', label: 'a', source: 's' }] } })).toEqual([])
    const noSource = landingProblems({ ru: { stats: [{ num: '120', label: 'списков', source: '' }] } })
    expect(noSource).toHaveLength(1)
    expect(noSource[0]).toContain('ru.stats[1]')
    const tooMany = Array.from({ length: LANDING_MAX_STATS + 1 }, (_, i) => ({ num: String(i), label: 'x', source: 's' }))
    expect(landingProblems({ en: { stats: tooMany } }).join()).toContain('at most')
    expect(landingProblems({ en: { heroTitle: 'x'.repeat(landingMaxLength('heroTitle') + 1) } }).join()).toContain('en.heroTitle')
    // Пустая строка плитки (добавили и не заполнили) — не проблема: её просто нет.
    expect(landingProblems({ en: { stats: [{ num: '', label: '', source: '' }] } })).toEqual([])
  })

  it('сверх лимита и сверх четырёх плиток не читается и из хранилища', () => {
    const o = sanitizeOverrides({
      en: { heroTitle: 'x'.repeat(landingMaxLength('heroTitle') + 1), stats: Array.from({ length: 6 }, (_, i) => ({ num: String(i), label: 'x', source: 's' })) },
    })
    expect(o.en.texts).toEqual({})
    expect(o.en.stats).toHaveLength(LANDING_MAX_STATS)
  })
})
