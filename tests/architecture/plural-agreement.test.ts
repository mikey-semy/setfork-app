import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ЧИСЛО РЯДОМ СО СЛОВАРНЫМ СУЩЕСТВИТЕЛЬНЫМ, У КОТОРОГО ЕСТЬ ФОРМЫ.
 *
 * `t('lists', lang)` — это заголовок «Списки», и рядом с числом он даёт «5 списки»,
 * «1 списки», «22 списки». На английском та же строка ошибается только при единице
 * («1 lists»), поэтому дефект переживает любую проверку, сделанную на одной локали:
 * английский почти всегда прав по совпадению.
 *
 * Ловим КЛАСС, а не экземпляр: карточку папки звёзд починили точечно, но правило
 * («у ключа есть формы в PLURALS — значит рядом с числом обязан стоять plural()»)
 * иначе живёт только в голове того, кто чинил.
 *
 * Проверяется ровно один шаблон — число, пробел, `t(<ключ с формами>)`, — потому что
 * доказуемо именно он. Число, собранное в переменную двумя строками выше, тест не
 * увидит, и делать вид, что увидит, не надо.
 */

const SRC = 'src'

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []
  })

/** Ключи, у которых объявлены формы, — источник тот же, что у `plural()`. */
const pluralKeys = (): string[] => {
  const src = readFileSync('src/shared/i18n/index.ts', 'utf8')
  const block = src.slice(src.indexOf('const PLURALS'), src.indexOf('} as const'))
  return [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:\s*\{/gm)].map((m) => m[1])
}

describe('согласование числа и существительного', () => {
  it('рядом с числом стоит plural(), а не словарный заголовок', () => {
    const keys = pluralKeys()
    expect(keys).toContain('lists')
    // `{count} {t('lists', lang)}` в JSX и `${count} ${t('lists', lang)}` в шаблоне.
    const pattern = new RegExp(String.raw`\$?\{[^{}]*\}\s*\$?\{\s*t\(\s*'(${keys.join('|')})'`, 'g')

    const hits: string[] = []
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(pattern)) {
        const line = text.slice(0, m.index).split('\n').length
        hits.push(`${file}:${line} — t('${m[1]}') рядом с числом; нужен plural(n, '${m[1]}', lang)`)
      }
    }
    expect(hits).toEqual([])
  })
})
