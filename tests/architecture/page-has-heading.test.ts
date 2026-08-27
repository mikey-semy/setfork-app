import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * У КАЖДОЙ СТРАНИЦЫ ЕСТЬ ЗАГОЛОВОК ПЕРВОГО УРОВНЯ.
 *
 * Человек без зрения ходит по сайту не глазами, а СПИСКОМ ЗАГОЛОВКОВ: диктор умеет
 * перечислить их и прыгнуть к нужному, и первый вопрос при открытии страницы — «куда
 * я попал». Страница без `h1` на этот вопрос не отвечает вовсе (WCAG 2.4.6).
 *
 * Замер 26.08.2026: из 77 страниц заголовка не было у 24 — включая вход, регистрацию,
 * поиск, Explore, «в тренде» и админку. Видимого заголовка у них нет по замыслу, поэтому
 * добавлен `sr-only`: для глаз ничего не изменилось, для диктора появилось имя места.
 *
 * Проверка смотрит НЕ ТОЛЬКО файл страницы: заголовок законно рисует и вложенный
 * компонент, и layout сегмента (у страницы списка так и есть). Поэтому обход идёт по
 * импортам на два уровня и по всем layout выше по маршруту — иначе тест ловил бы
 * законные места и его бы отключили.
 *
 * Исключение одно и проверяемое: страница-редирект, у которой нет разметки вообще.
 */

const APP = join('src', 'app')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

const resolveImport = (from: string, spec: string): string | null => {
  const base = spec.startsWith('@/') ? join('src', spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const c of [`${base}.tsx`, join(base, 'index.tsx')]) if (existsSync(c)) return c
  return null
}

const hasHeading = (file: string, depth = 0, seen = new Set<string>()): boolean => {
  if (depth > 2 || seen.has(file)) return false
  seen.add(file)
  const src = read(file)
  if (/<h1[\s>]/.test(src)) return true
  return [...src.matchAll(/from '([^']+)'/g)]
    .map((m) => resolveImport(file, m[1]))
    .some((d) => d !== null && d.endsWith('.tsx') && hasHeading(d, depth + 1, seen))
}

/** Заголовок может прийти из любого layout выше по дереву маршрута. */
const layoutsAbove = (page: string): string[] => {
  const out: string[] = []
  let d = dirname(page)
  while (d.startsWith(APP)) {
    const l = join(d, 'layout.tsx')
    if (existsSync(l)) out.push(l)
    d = dirname(d)
  }
  return out
}

/** Страница без разметки: только `redirect()`. Заголовку там неоткуда взяться и незачем. */
const isRedirectOnly = (file: string) => {
  const src = read(file)
  return /\bredirect\(/.test(src) && !/return \(/.test(src)
}

describe('заголовок страницы', () => {
  it('есть у каждой страницы, которая что-то показывает', () => {
    const pages = walk(APP).filter((p) => p.endsWith(`${'page'}.tsx`))
    expect(pages.length).toBeGreaterThan(50)

    const without = pages
      .filter((p) => !isRedirectOnly(p))
      .filter((p) => !hasHeading(p) && !layoutsAbove(p).some((l) => hasHeading(l)))

    expect(
      without,
      `Страница без h1: диктор не скажет человеку, куда он попал.\n` +
        `Видимый заголовок не нужен — достаточно <h1 className="sr-only">{…}</h1> с тем же\n` +
        `текстом, что и в generateMetadata.\n${without.join('\n')}`,
    ).toEqual([])
  })
})
