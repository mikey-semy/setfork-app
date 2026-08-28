import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ВОРОТА РЕВЬЮ — ОДИН НАБОР НА ВСЕ ПУТИ ПРИНЯТИЯ.
 *
 * Путей к записи в main три: слияние ветки, принятие предложения из пунктов и РЕЗОЛВЕР
 * КОНФЛИКТОВ. Третий про это забыли: он выписал те же четверо ворот своим списком —
 * ровно то, ради чего заведён `reviewGates` («правило должно быть одно — иначе настройка
 * работает у одного вида предложений и молча не работает у другого»).
 *
 * И копия успела разойтись с оригиналом в главном: она МОЛЧА возвращалась, тогда как
 * общий набор отдаёт причину. Человек нажимал «Применить разрешение конфликтов» и не
 * получал ничего — ни результата, ни объяснения.
 *
 * Тест ловит появление ЧЕТВЁРТОЙ копии: спрашивать `hasBlockingReview`,
 * `countApprovals` и `countUnresolvedThreads` вправе только сам модуль ворот. Проверка
 * на уровне кода, а не поведения, потому что путей может стать больше, а фикстура ветки
 * требует живого репозитория — то есть тест поведения покрыл бы не все входы.
 */
const GATE_CALLS = /\b(hasBlockingReview|countApprovals|countUnresolvedThreads)\s*\(/
const OWNER = 'src/features/library/suggestion-core/gates.ts'
const SRC = new URL('../../src', import.meta.url).pathname

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

describe('принятие правки идёт через одну точку', () => {
  it('прямых вызовов applySuggestion вне ядра нет', () => {
    // `applySuggestion` — ПОЛОВИНА действия: она создаёт версию, но не пишет
    // `merged_version`, а по нему работает откат. Оба внешних входа — кнопка на сайте
    // и MCP — звали именно её, и откат принятой правки был невозможен: страница не
    // показывала кнопку, ядро отвечало «принято до появления отката». Точка входа
    // одна — `mergeSuggestion`, она сама разбирает вид предложения.
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = file.slice(file.indexOf('src/'))
      if (rel.startsWith('src/features/library/suggestion-core/')) continue
      for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        if (line.trimStart().startsWith('import') || line.trimStart().startsWith('*')) continue
        if (/\bapplySuggestion\s*\(/.test(line)) offenders.push(`${rel}:${i + 1}`)
      }
    }
    expect(offenders, 'принимать правку следует через mergeSuggestion').toEqual([])
  })
})

describe('ворота ревью спрашиваются в одном месте', () => {
  it('прямых вызовов гейтов вне модуля ворот нет', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = file.slice(file.indexOf('src/'))
      // Сам модуль ворот и определения запросов — законные места.
      if (rel === OWNER || rel.endsWith('review-queries.ts') || rel.endsWith('comments/queries.ts')) continue
      const src = readFileSync(file, 'utf8')
      // Импорт без вызова безвреден: ловим именно вызов.
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trimStart().startsWith('import')) continue
        if (GATE_CALLS.test(line)) offenders.push(`${rel}:${i + 1}`)
      }
    }
    expect(offenders, 'ворота ревью обязаны спрашиваться через reviewGates').toEqual([])
  })
})
