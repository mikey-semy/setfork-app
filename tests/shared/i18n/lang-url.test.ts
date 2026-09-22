import { describe, expect, it } from 'vitest'
import { langAlternates, langHref, splitLangPath } from '@/shared/i18n/url'

/**
 * ЯЗЫКОВОЙ ПРЕФИКС — ЭТО СЕГМЕНТ, А НЕ НАЧАЛО СТРОКИ.
 *
 * Правка развела языки по адресам (`/ru/explore`, `/en/explore`), потому что русская
 * версия была невидима поисковикам: она отдавалась по тому же адресу через
 * `Accept-Language`, а YandexBot этот заголовок не шлёт.
 *
 * Самый дешёвый способ всё испортить — считать префиксом начало пути. Тогда список
 * `ruslan/runbook` уедет в русскую версию и потеряет свой адрес: пользователь получит
 * 404 там, где вчера была страница. В карте корней это K40 — «шаблон адреса написан
 * по подстроке, а не по границе», и он уже стоил нам одной правки.
 */
describe('разбор языкового префикса', () => {
  it.each([
    ['/ru', 'ru', '/'],
    ['/ru/', 'ru', '/'],
    ['/en/explore', 'en', '/explore'],
    ['/ru/miki/spisok', 'ru', '/miki/spisok'],
  ])('%s → язык %s, путь %s', (input, lang, rest) => {
    expect(splitLangPath(input)).toEqual({ lang, rest })
  })

  it.each([
    ['/rust', 'ник начинается на ru, но это не префикс'],
    ['/ruslan/runbook', 'ник целиком, а не язык'],
    ['/english', 'то же с en'],
    ['/explore', 'обычный путь'],
    ['/', 'корень'],
  ])('%s — префикса НЕТ (%s)', (input) => {
    expect(splitLangPath(input)).toEqual({ lang: null, rest: input })
  })

  it('двухбуквенный сегмент неизвестного языка префиксом не считается', () => {
    // `/de/...` — это не язык интерфейса, а чей-то ник. Принять его за префикс значит
    // увести человека на несуществующую страницу; чужой ник дороже удобства разбора.
    expect(splitLangPath('/de/spisok')).toEqual({ lang: null, rest: '/de/spisok' })
  })
})

describe('адрес того же места на другом языке', () => {
  it('корень получает префикс без хвостового слэша', () => {
    expect(langHref('/', 'ru')).toBe('/ru')
  })

  it('путь с префиксом переписывается, а не наращивается', () => {
    // Иначе из `/ru/explore` вышло бы `/en/ru/explore` — и переключатель языка на
    // второй клик уводил бы в никуда.
    expect(langHref('/ru/explore', 'en')).toBe('/en/explore')
  })

  it('путь без префикса получает его', () => {
    expect(langHref('/explore', 'ru')).toBe('/ru/explore')
  })
})

describe('взаимные ссылки hreflang', () => {
  it('оба языка и x-default, считая от пути без префикса', () => {
    const { languages, xDefault } = langAlternates('/ru/explore', 'https://setfork.com')
    expect(languages).toEqual({
      en: 'https://setfork.com/en/explore',
      ru: 'https://setfork.com/ru/explore',
    })
    // x-default — адрес БЕЗ языка: он сам выберет язык тому, чей нам неизвестен.
    expect(xDefault).toBe('https://setfork.com/explore')
  })

  it('ссылки взаимны: с любой версии видны обе', () => {
    // Требование аудита — «hreflang на каждой паре страниц, взаимно». Односторонняя
    // ссылка поисковиком не засчитывается вовсе.
    const fromEn = langAlternates('/en/explore', 'https://setfork.com')
    const fromRu = langAlternates('/ru/explore', 'https://setfork.com')
    expect(fromEn.languages).toEqual(fromRu.languages)
  })
})
