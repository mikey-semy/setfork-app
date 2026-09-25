import { describe, expect, it } from 'vitest'
import { hasLangPreference, negotiateLang, preferredLang } from '@/shared/i18n/negotiate'

// Разбор Accept-Language был продублирован: серверный резолвер интерфейса перебирал теги
// по порядку, git-транспорт брал первый — и обе копии выбрасывали веса `q`. Для
// `ru;q=0.1,en;q=1.0` это означало русский, хотя клиент явно просил английский
// (карточка ревью git/011). По RFC 9110 §12.5.4 приоритет задаёт `q`, а не порядок.
describe('negotiateLang — веса решают, а не порядок', () => {
  it('больший вес выигрывает, даже если стоит вторым', () => {
    expect(negotiateLang('ru;q=0.1,en;q=1.0')).toBe('en')
    expect(negotiateLang('en;q=0.2,ru;q=0.9')).toBe('ru')
  })

  it('без весов приоритет отдаётся порядку (все веса равны 1)', () => {
    expect(negotiateLang('ru,en')).toBe('ru')
    expect(negotiateLang('en,ru')).toBe('en')
  })

  it('регион отбрасывается: ru-RU — это ru', () => {
    expect(negotiateLang('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru')
  })

  it('q=0 — это запрет языка, а не слабое предпочтение', () => {
    expect(negotiateLang('ru;q=0, en;q=0.1')).toBe('en')
  })

  it('незнакомые языки пропускаются, а не выигрывают', () => {
    expect(negotiateLang('de,fr;q=0.9,ru;q=0.1')).toBe('ru')
  })

  it('пустой, отсутствующий и бессодержательный заголовок дают язык по умолчанию', () => {
    expect(negotiateLang('')).toBe('en')
    expect(negotiateLang(null)).toBe('en')
    expect(negotiateLang('*')).toBe('en')
    expect(negotiateLang('de,fr')).toBe('en')
  })

  it('испорченный вес не роняет разбор и читается как 1', () => {
    expect(negotiateLang('ru;q=абв,en;q=0.5')).toBe('ru')
  })

  it('пробелы и регистр не мешают', () => {
    expect(negotiateLang('  RU-ru ; q=0.4 , EN ; q=0.8 ')).toBe('en')
  })
})

/**
 * «Не назвал язык» ≠ «английский» (ADR-0030). Робот поисковика не шлёт `Accept-Language`, и ему
 * страница списка отдаётся на языке самого списка; человек, приславший `en`, получает `en`.
 * Сливать эти случаи в один `en` значило бы показывать роботу русский список английским.
 */
describe('preferredLang — назвал ли клиент язык', () => {
  it.each([null, '', '*', 'de', 'de-DE,fr;q=0.8', 'ru;q=0'])('%j — не назвал знакомого: null', (header) => {
    expect(preferredLang(header)).toBeNull()
  })

  it.each([
    ['en', 'en'],
    ['ru-RU,ru;q=0.9', 'ru'],
    ['de,en;q=0.5', 'en'],
  ])('%s → %s', (header, lang) => {
    expect(preferredLang(header)).toBe(lang)
  })

  it('negotiateLang по-прежнему отдаёт язык по умолчанию, когда клиент промолчал', () => {
    expect(negotiateLang(null)).toBe('en')
  })
})

describe('hasLangPreference — прислал ли клиент хоть какой-то язык', () => {
  it.each([
    [null, false],
    ['', false],
    ['  ', false],
    ['*', false],
    ['de', true],
    ['en', true],
  ])('%j → %s', (header, want) => {
    expect(hasLangPreference(header)).toBe(want)
  })
})
