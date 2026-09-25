import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * КАЖДЫЙ `<script>`, НАПИСАННЫЙ РУКАМИ, НЕСЁТ NONCE.
 *
 * Свои скрипты Next.js помечает сам, а тег, написанный в JSX, — нет. Без `nonce` он
 * попадает в нарушения политики скриптов (shared/security/csp.ts), а когда политика
 * станет боевой, — перестаёт исполняться: тема мигнёт, аналитика замолчит, и никто не
 * заметит сразу. Исключение — данные (`type="application/ld+json"`): браузер их не
 * исполняет, и политика скриптов их не касается.
 */
const files = globSync('src/**/*.tsx')
const TAG = /<script\b[^>]*>/gs
/** Тег, упомянутый в комментарии, — не тег: вырезаем блочные и строчные комментарии. */
const code = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('узда: <script> с nonce', () => {
  it('в src/**/*.tsx нет исполняемого <script> без nonce', () => {
    const bad: string[] = []
    for (const f of files) {
      for (const m of code(f).matchAll(TAG)) {
        const tag = m[0]
        if (/type="application\/ld\+json"/.test(tag)) continue
        if (!/\bnonce=/.test(tag)) bad.push(`${f}: ${tag.slice(0, 60)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('узда видит теги: в корневом layout их находит', () => {
    const tags = [...code('src/app/layout.tsx').matchAll(TAG)]
    expect(tags.length).toBeGreaterThanOrEqual(2)
  })
})
