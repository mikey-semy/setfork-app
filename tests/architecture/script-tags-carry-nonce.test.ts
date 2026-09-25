import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * КАЖДЫЙ `<script>`, НАПИСАННЫЙ РУКАМИ, НЕСЁТ NONCE.
 *
 * Свои скрипты Next.js помечает сам, а тег, написанный в JSX, — нет. Без `nonce` он
 * попадает в нарушения политики скриптов (shared/security/csp.ts), а когда политика
 * станет боевой, — перестаёт исполняться: тема мигнёт, аналитика замолчит, и никто не
 * заметит сразу. Касается и `<Script>` из next/script: в App Router nonce ему передают
 * руками. Исключение — данные (`type="application/ld+json"`): браузер их не исполняет.
 *
 * ⚠️ Проверка по СИНТАКСИЧЕСКОМУ ДЕРЕВУ, а не регуляркой по тексту: первая редакция
 * вырезала комментарии регуляркой, приняла `/*` внутри строчного комментария за начало
 * блока и не видела 54 строки настоящего кода (найдено ревью по линзам, доказано
 * мутацией). Атрибут `nonce` обязан быть выражением, а не пустым значением.
 */
type Tag = { file: string; line: number; name: string; ok: boolean }

/**
 * Что выпускает исполняемый скрипт: теги и компоненты, рисующие inline-скрипт сами.
 * `ThemeProvider` (next-themes) ставит скрипт темы до гидрации и берёт nonce пропом.
 */
const EMITTERS = new Set(['script', 'Script', 'ThemeProvider'])

/**
 * ⚠️ Дерево строится только у файлов, где имя такого тега вообще встречается в тексте:
 * без этого разбор всех ~450 `.tsx` шёл за секунду в простое и не укладывался в
 * тайм-аут теста под нагрузкой прогона с покрытием (master, 25.09). Фильтр ничего не
 * теряет: тег не может оказаться в файле, не упомянув своё имя.
 */
const MENTIONS = new RegExp(`<(?:${[...EMITTERS].join('|')})\\b`)

function scriptTags(file: string): Tag[] {
  const text = readFileSync(file, 'utf8')
  if (!MENTIONS.test(text)) return []
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: Tag[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(sf)
      if (EMITTERS.has(name)) {
        const attrs = new Map<string, ts.JsxAttribute>()
        for (const a of node.attributes.properties) if (ts.isJsxAttribute(a)) attrs.set(a.name.getText(sf), a)
        const type = attrs.get('type')?.initializer
        const isData = !!type && ts.isStringLiteral(type) && type.text === 'application/ld+json'
        const nonce = attrs.get('nonce')?.initializer
        const hasNonce = !!nonce && ts.isJsxExpression(nonce) && !!nonce.expression && nonce.expression.getText(sf) !== 'undefined'
        out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, name, ok: isData || hasNonce })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('узда: <script> с nonce', () => {
  it('в src/**/*.tsx нет исполняемого <script>/<Script> без nonce', () => {
    const bad = globSync('src/**/*.tsx')
      .flatMap(scriptTags)
      .filter((t) => !t.ok)
      .map((t) => `${t.file}:${t.line} <${t.name}>`)
    expect(bad).toEqual([])
  })

  it('узда видит теги: в корневом layout — тема, её провайдер и аналитика', () => {
    const names = scriptTags('src/app/layout.tsx').map((t) => t.name)
    expect(names.filter((n) => n === 'script').length).toBeGreaterThanOrEqual(2)
    expect(names).toContain('ThemeProvider')
  })
})
