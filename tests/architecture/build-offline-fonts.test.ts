import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * СБОРКА НЕ ХОДИТ ЗА ШРИФТАМИ В ИНТЕРНЕТ.
 *
 * `next/font/google` качает файлы на КАЖДОЙ сборке. 20.08.2026 `fonts.gstatic.com` перестал
 * отвечать через рабочий туннель — и перестало собираться всё: локально и в CI (раннеры на
 * той же машине), при полностью исправном коде. Отказ чужого сервиса был засчитан нам.
 *
 * Шрифты лежат в репозитории (`src/shared/fonts` — не в `app`, где каталог означал бы
 * маршрут и занимал ник), подключаются через `next/font/local`.
 * Проверка держит именно это: вернуть `next/font/google` — значит вернуть в середину гейта
 * внешнюю зависимость, и заметят это не на ревью, а в день, когда провайдер моргнёт.
 *
 * Файлы проверяются на существование и непустоту: `next/font/local` при отсутствии файла
 * падает на сборке, но пустой (например, обрезанный при копировании) даст молча пустой шрифт.
 */

const SRC = join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('сборка не зависит от внешних шрифтов', () => {
  // Ищем ИМПОРТ, а не упоминание: первая версия проверки ловила собственный комментарий,
  // объясняющий, почему этого импорта здесь больше нет.
  const IMPORTS_GOOGLE = /(?:from\s*|require\(\s*)['"]next\/font\/google['"]/

  it('никто не импортирует next/font/google', () => {
    const guilty = walk(SRC).filter((f) => IMPORTS_GOOGLE.test(readFileSync(f, 'utf8')))
    expect(guilty.map((f) => f.replace(process.cwd() + '/', ''))).toEqual([])
  })

  it('файлы шрифтов лежат в репозитории и не пусты', () => {
    const dir = join(SRC, 'shared', 'fonts')
    const files = readdirSync(dir).filter((f) => f.endsWith('.woff2'))
    expect(files.length).toBeGreaterThan(0)
    const empty = files.filter((f) => statSync(join(dir, f)).size < 1024)
    expect(empty).toEqual([])
  })

  it('каждый объявленный в layout файл существует', () => {
    const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8')
    const declared = [...layout.matchAll(/(?:path|src): '\.\.\/shared\/fonts\/([^']+)'/g)].map((m) => m[1])
    expect(declared.length).toBeGreaterThan(0)
    const present = new Set(readdirSync(join(SRC, 'shared', 'fonts')))
    expect(declared.filter((f) => !present.has(f))).toEqual([])
  })
})
