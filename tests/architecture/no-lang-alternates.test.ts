import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ЯЗЫКА В АДРЕСЕ НЕТ — И ССЫЛОК НА ЯЗЫКОВЫЕ ВЕРСИИ ТОЖЕ (ADR-0029, 25.09.2026).
 *
 * `hreflang` (`alternates.languages` в метаданных и карте сайта Next) описывает разные
 * адреса одной страницы на разных языках. Адрес у нас один, и такие ссылки указывали бы
 * на `/ru/…` и `/en/…`, которые отвечают 308, — поисковик счёл бы их ошибкой разметки.
 * Узда — чтобы помощник вида «добавим языки в alternates» не вернулся тихо.
 */
/** Код без комментариев: слово «hreflang» в пояснениях законно. */
const code = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')

describe('узда: без ссылок на языковые версии', () => {
  it('в src нет `alternates.languages` и `hrefLang`', () => {
    const bad = globSync('src/**/*.{ts,tsx}').filter((f) => {
      const c = code(f)
      return /hrefLang|hreflang/.test(c) || (/alternates/.test(c) && /\blanguages\s*:/.test(c))
    })
    expect(bad).toEqual([])
    // Чтение всего src: в простое доли секунды, под прогоном с покрытием — в разы дольше.
  }, 30_000)
})
