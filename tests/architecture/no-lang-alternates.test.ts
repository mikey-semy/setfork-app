import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * ЯЗЫКА В АДРЕСЕ НЕТ — И ССЫЛОК НА ЯЗЫКОВЫЕ ВЕРСИИ ТОЖЕ (ADR-0029, 25.09.2026).
 *
 * `hreflang` (`alternates.languages` в метаданных и карте сайта Next) описывает разные
 * адреса одной страницы на разных языках. Адрес у нас один, и такие ссылки указывали бы
 * на `/ru/…` и `/en/…`, которые отвечают 308, — поисковик счёл бы их ошибкой разметки.
 *
 * ⚠️ По синтаксическому дереву, а не регуляркой: первая редакция не видела сокращённую
 * запись `{ canonical, languages }`, ключ строкой и помощника в другом файле, возвращающего
 * такой объект (ревью по линзам). Ловим ключ `languages` в ЛЮБОЙ форме в объекте, который
 * лежит в `alternates` или стоит рядом с `canonical`, и атрибут `hrefLang` в JSX.
 */
const keyName = (p: ts.ObjectLiteralElementLike): string | undefined => {
  if (ts.isShorthandPropertyAssignment(p)) return p.name.text
  if (!p.name) return undefined
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text
  return undefined
}

function hits(text: string, file = 'probe.tsx'): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const keys = n.properties.map(keyName)
      const parent = n.parent
      const inAlternates = ts.isPropertyAssignment(parent) && keyName(parent) === 'alternates'
      if (keys.includes('languages') && (inAlternates || keys.includes('canonical'))) out.push(n.getText(sf).slice(0, 60))
    }
    if (ts.isJsxAttribute(n) && /^hreflang$/i.test(n.name.getText(sf))) out.push(n.getText(sf))
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('узда: без ссылок на языковые версии', () => {
  it('в src нет `alternates.languages` и `hrefLang`', () => {
    const bad = globSync('src/**/*.{ts,tsx}')
      .filter((f) => /languages|hreflang/i.test(readFileSync(f, 'utf8')))
      .flatMap((f) => hits(readFileSync(f, 'utf8'), f).map((h) => `${f}: ${h}`))
    expect(bad).toEqual([])
  }, 30_000)

  it('узда видит все формы', () => {
    for (const code of [
      'const m = { alternates: { canonical, languages: { ru: "/ru" } } }',
      'const m = { alternates: { canonical, languages } }',
      "const m = { alternates: { 'languages': x } }",
      'const helper = (p: string) => ({ canonical: p, languages })',
      'const el = <link rel="alternate" hrefLang="ru" href="/ru" />',
    ])
      expect(hits(code), code).not.toEqual([])
    // Ключ `languages` вне адресов — не наше дело (например, языки подсветки кода).
    expect(hits('const hl = { languages: ["ts", "rust"] }')).toEqual([])
  })
})
