import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * УЗДА КОРНЯ K15: ПУБЛИЧНЫЙ АДРЕС НЕ СОБИРАЕТСЯ ИЗ АДРЕСА ЗАПРОСА.
 *
 * За прокси `req.url` собран из адреса, на котором слушает контейнер, и его `origin`
 * равен `https://0.0.0.0:3000`. Так на проде адрес `0.0.0.0:3000` получали чужой код
 * (`data.json`), страница встраивания, скрипт `raw` и сертификат. Семь проявлений одного
 * корня (setfork-hq, reviews/problems/CLUSTERS.md, K15; fe#968), чинились поштучно.
 * Правило карты корней: с третьего повтора — машинная проверка.
 *
 * Канонический адрес — `appOrigin()` (shared/auth/app-origin.ts) или `SITE_ORIGIN`.
 *
 * Ищем по синтаксическому дереву `.origin` у адреса запроса:
 *  - `new URL(<что-то>.url).origin`;
 *  - `<что-то>.nextUrl.origin`;
 *  - `u.origin`, где `u` в том же файле заведена как `new URL(<что-то>.url)` или `….nextUrl`.
 * Адрес ЧУЖОГО документа (отчёт CSP, ссылка из списка) — не адрес запроса, его узда не видит.
 */

const isReqUrl = (e: ts.Expression): boolean =>
  (ts.isNewExpression(e) && e.expression.getText() === 'URL' && !!e.arguments?.[0] && ts.isPropertyAccessExpression(e.arguments[0]) && e.arguments[0].name.text === 'url' && e.arguments.length === 1) ||
  (ts.isPropertyAccessExpression(e) && e.name.text === 'nextUrl')

/** Все `.origin` адреса запроса в разобранном файле — текстом выражения и строкой. */
function hitsIn(sf: ts.SourceFile): string[] {
  const fromReq = new Set<string>()
  const out: string[] = []
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isReqUrl(n.initializer)) fromReq.add(n.name.text)
    ts.forEachChild(n, collect)
  }
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'origin') {
      const obj = ts.isParenthesizedExpression(n.expression) ? n.expression.expression : n.expression
      if (isReqUrl(obj) || (ts.isIdentifier(obj) && fromReq.has(obj.text))) {
        out.push(`${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${n.getText(sf)}`)
      }
    }
    ts.forEachChild(n, visit)
  }
  collect(sf)
  visit(sf)
  return out
}

const parse = (file: string, text = readFileSync(file, 'utf8')) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** Дерево строим только там, где есть что искать: иначе обход всего src — секунды. */
const candidates = () => globSync('src/**/*.{ts,tsx}').filter((f) => /\.origin\b/.test(readFileSync(f, 'utf8')))

describe('узда K15: публичный адрес — из конфигурации, не из запроса', () => {
  it('в src нет `.origin` адреса запроса', () => {
    expect(candidates().flatMap((f) => hitsIn(parse(f)))).toEqual([])
  })

  it('узда видит все три формы', () => {
    const code = [
      'export const a = (req: Request) => new URL(req.url).origin',
      'export const b = (req: { nextUrl: URL }) => req.nextUrl.origin',
      'export function c(req: Request) { const u = new URL(req.url); return `${u.origin}/x` }',
      // Адрес чужого документа — не адрес запроса.
      'export const ok = (s: string) => new URL(s).origin',
    ].join('\n')
    expect(hitsIn(parse('probe.ts', code))).toHaveLength(3)
  })
})
