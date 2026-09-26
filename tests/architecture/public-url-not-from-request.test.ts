import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * УЗДА КОРНЯ K15: ПУБЛИЧНЫЙ АДРЕС НЕ СОБИРАЕТСЯ ИЗ АДРЕСА ЗАПРОСА.
 *
 * За прокси `req.url` собран из адреса, на котором слушает контейнер, и его `origin`
 * равен `https://0.0.0.0:3000`. Так на проде адрес `0.0.0.0:3000` получали чужой код
 * (`data.json`), страница встраивания, скрипт `raw`, экспорт и сертификат — пять карточек
 * одного корня (setfork-hq, reviews/problems/CLUSTERS.md, K15: cert-009, data-009,
 * embed-008, export-011, raw-009; fe#968), чинились поштучно.
 * Правило карты корней: с третьего повтора — машинная проверка.
 *
 * Канонический адрес — `appOrigin()` (shared/auth/app-origin.ts) или `SITE_ORIGIN`.
 *
 * Ищем по синтаксическому дереву всё, чем из запроса достают хост:
 *  - `.origin`, `.host`, `.hostname`, `.protocol`, `.href`, `.toString()` и деструктуризацию
 *    `{ origin }` у адреса запроса — `new URL(req.url)`, `req.nextUrl` и переменной из них;
 *  - `new URL(путь, req.url)` — адрес с базой запроса;
 *  - заголовок `host` / `x-forwarded-host`.
 * «Запрос» — объект с именем `req`, `request`, `_req`: `new URL(ref.url)` у ссылки шага —
 * адрес ЧУЖОГО документа, и узда его не трогает (первая редакция путала их — ревью по линзам).
 */

const REQ = new Set(['req', 'request', '_req'])
const HOST_PARTS = new Set(['origin', 'host', 'hostname', 'protocol', 'href'])

/**
 * Законные исключения: файл → форма → почему это не публичный адрес.
 * Всё прочее — нарушение, даже в этих файлах.
 */
const ALLOWED: Record<string, { form: 'base' | 'header'; why: string }> = {
  // Next в middleware делает Location относительным, если хост совпадает с хостом запроса
  // (next/dist/server/web/adapter.js, getRelativeURL): наружу `0.0.0.0` не уходит. В
  // обработчике маршрута такой нормализации НЕТ — там та же строка была бы нарушением.
  'src/middleware.ts': { form: 'base', why: 'rewrite/redirect в middleware нормализуются в относительный адрес' },
  // Сравнение Origin с Host против CSRF: адрес не строится, только сверяется.
  'src/shared/csrf.ts': { form: 'header', why: 'сверка Origin с Host, адрес не строится' },
}

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ? unwrap(e.expression) : e

const isReq = (e: ts.Expression) => ts.isIdentifier(unwrap(e)) && REQ.has((unwrap(e) as ts.Identifier).text)

/** `req.url` */
const isReqDotUrl = (e: ts.Expression) => {
  const x = unwrap(e)
  return ts.isPropertyAccessExpression(x) && x.name.text === 'url' && isReq(x.expression)
}

type Hit = { line: number; form: 'host' | 'base' | 'header'; text: string }

function hitsIn(sf: ts.SourceFile): Hit[] {
  const fromReq = new Set<string>()
  /** Адрес запроса: `new URL(req.url)`, `req.nextUrl`, переменная из них. */
  const isReqUrl = (e: ts.Expression): boolean => {
    const x = unwrap(e)
    if (ts.isNewExpression(x) && x.expression.getText(sf) === 'URL' && x.arguments?.length === 1 && isReqDotUrl(x.arguments[0])) return true
    if (ts.isPropertyAccessExpression(x) && x.name.text === 'nextUrl' && isReq(x.expression)) return true
    return ts.isIdentifier(x) && fromReq.has(x.text)
  }
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isReqUrl(n.initializer)) fromReq.add(n.name.text)
    ts.forEachChild(n, collect)
  }
  const out: Hit[] = []
  const at = (n: ts.Node, form: Hit['form']) =>
    out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, form, text: n.getText(sf).slice(0, 80) })
  const visit = (n: ts.Node) => {
    // u.origin / req.nextUrl.host / new URL(req.url).href
    if (ts.isPropertyAccessExpression(n) && HOST_PARTS.has(n.name.text) && isReqUrl(n.expression)) at(n, 'host')
    // u['origin']
    if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && HOST_PARTS.has(n.argumentExpression.text) && isReqUrl(n.expression)) at(n, 'host')
    // `${u}` не ловим (адрес целиком в строке — редкость), а u.toString() — да
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'toString' && isReqUrl(n.expression.expression)) at(n, 'host')
    // const { origin } = new URL(req.url)
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && isReqUrl(n.initializer)) {
      if (n.name.elements.some((el) => HOST_PARTS.has((el.propertyName ?? el.name).getText(sf)))) at(n, 'host')
    }
    // new URL('/x', req.url) — адрес с базой запроса
    if (ts.isNewExpression(n) && n.expression.getText(sf) === 'URL' && n.arguments?.length === 2 && (isReqDotUrl(n.arguments[1]) || isReqUrl(n.arguments[1]))) at(n, 'base')
    // headers.get('host') / get('x-forwarded-host')
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'get') {
      const a = n.arguments[0]
      if (a && ts.isStringLiteral(a) && /^(x-forwarded-)?host$/i.test(a.text)) at(n, 'header')
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
const MENTIONS = /\b(req|request|_req)\.url\b|nextUrl|['"](x-forwarded-)?host['"]/
const violations = (file: string, text?: string) =>
  hitsIn(parse(file, text))
    .filter((h) => ALLOWED[file]?.form !== h.form)
    .map((h) => `${file}:${h.line} ${h.text}`)

describe('узда K15: публичный адрес — из конфигурации, не из запроса', () => {
  it('в src хост не берётся из запроса', () => {
    const files = globSync('src/**/*.{ts,tsx}').filter((f) => MENTIONS.test(readFileSync(f, 'utf8')))
    expect(files.flatMap((f) => violations(f))).toEqual([])
    // Чтение всех файлов src и разбор ~30 из них: в простое полсекунды, под прогоном с
    // покрытием — в разы дольше; соседняя узда nonce упала ровно на этом (master, 25.09).
  }, 30_000)

  it('узда видит все формы — и не путает запрос со ссылкой из списка', () => {
    const bad = [
      'const a = (req: Request) => new URL(req.url).origin',
      'const b = (req: { nextUrl: URL }) => req.nextUrl.host',
      'function c(req: Request) { const u = new URL(req.url); return `${u.protocol}//${u.host}/x` }',
      'function d(request: Request) { const { origin } = new URL(request.url); return origin }',
      'const e = (req: Request) => new URL("/x", req.url).toString()',
      'const f = (req: Request) => req.headers.get("x-forwarded-host")',
      'const g = (req: Request) => (new URL(req.url) as URL)["href"]',
    ]
    for (const code of bad) expect(violations('src/app/probe/route.ts', code), code).not.toEqual([])
    const good = [
      'const ok1 = (ref: { url: string }) => new URL(ref.url).origin',
      'const ok2 = (s: string) => new URL(s).origin',
      'const ok3 = (req: Request) => new URL(req.url).searchParams.get("lang")',
    ]
    for (const code of good) expect(violations('src/app/probe/route.ts', code), code).toEqual([])
  })

  it('исключение — только для своей формы: в middleware хост из запроса по-прежнему нарушение', () => {
    expect(violations('src/middleware.ts', 'const r = (req: Request) => new URL("/x", req.url)')).toEqual([])
    expect(violations('src/middleware.ts', 'const r = (req: Request) => new URL(req.url).origin')).not.toEqual([])
  })
})
