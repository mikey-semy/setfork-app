import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { relSrc, walkSrc } from '../helpers/walk-src'

/**
 * КАНОН СТРАНИЦЫ СОБИРАЮТ ТОЛЬКО ЧЕРЕЗ ПОМОЩНИКИ, ЗНАЮЩИЕ ЯЗЫК АДРЕСА.
 *
 * SEO-1 развёл языки по адресам и научил им `pageMeta`. Пять страниц собирали канон
 * своими руками — и на `/ru/…` все пять называли каноном версию без языка, без единого
 * `hreflang`. Среди них сам список и профиль, то есть главное содержимое сайта (замер
 * прода 23.09.2026). Шестая страница, собравшая канон руками, повторит то же молча.
 *
 * Правило: страница, объявляющая `canonical`, идёт через `pageMeta` или `withLang`.
 */
const ALLOWED: Record<string, string> = {
  'src/app/layout.tsx': 'корневой макет сам строит канон из пути и языка адреса (langHref)',
}

describe('канон на языке адреса', () => {
  it('кто объявляет canonical, зовёт pageMeta или withLang', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src/app', import.meta.url).pathname)) {
      const src = readFileSync(file, 'utf8')
      // Объявление свойства (`canonical: …` или `{ canonical }` в `alternates`), а не слово в
      // комментарии.
      if (!/\bcanonical\s*:|alternates:\s*\{\s*canonical\s*\}/.test(src)) continue
      const rel = relSrc(file)
      if (rel in ALLOWED) continue
      if (/\b(withLang|pageMeta)\s*\(/.test(src)) continue
      offenders.push(rel)
    }
    expect(offenders, 'канон собран руками: на /ru/… он назовёт каноном версию без языка').toEqual([])
  })
})
