import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { likeContains } from '@/shared/db/like'

/**
 * ШАБЛОН ДЛЯ ILIKE СТРОИТ ТОЛЬКО `likeContains`.
 *
 * `%` и `_` — подстановочные знаки, а не буквы запроса. Написанный руками `%${q}%`
 * превращает поиск в язык шаблонов: `?q=%` возвращает ВСЁ, `?q=_b` находит «ab». Человек
 * при этом ищет буквально то, что набрал.
 *
 * Правило завели ещё в #809 — и оно не сработало, потому что лежало ВНУТРИ ОДНОЙ ФИЧИ
 * (`features/library/queries/shared`). Три соседние поверхности — задачи, правки,
 * обсуждения — строили шаблон руками, каждая по-своему; проверено на живой базе 19.08.
 * Отсюда две правки: помощник переехал в `shared/db/like`, и появился этот сторож.
 *
 * Проверка текстовая и намеренно узкая: ловится ровно форма «процент прямо вокруг
 * подстановки» — та, которой все три и грешили. Хитрее собранный шаблон она не увидит, и
 * делать вид, что увидит, не надо.
 */

const SRC = 'src'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

/** `%${...}%` и `'%' + x + '%'` — обе формы рукописного шаблона. */
const HANDMADE = [/%\$\{[^}]+\}%/, /'%'\s*\+/]

describe('экранирование шаблона поиска', () => {
  it('рукописного `%q%` в коде нет', () => {
    const found = walk(SRC)
      .filter((p) => /\.tsx?$/.test(p) && p !== join(SRC, 'shared', 'db', 'like.ts'))
      .flatMap((p) =>
        readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => ({ line: line.trim(), n: i + 1 }))
          .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
          .filter(({ line }) => HANDMADE.some((re) => re.test(line)))
          .map(({ line, n }) => `${p}:${n} ${line}`),
      )
    expect(found).toEqual([])
  })

  it('помощник обезвреживает все три знака', () => {
    // Проверяем ПОВЕДЕНИЕ, а не текст функции: тест на исходник переживает рефакторинг и
    // ничего не ловит. Обратный слэш экранируется первым — иначе он испортил бы уже
    // расставленные слэши.
    expect(likeContains('100%')).toBe('%100\\%%')
    expect(likeContains('_b')).toBe('%\\_b%')
    expect(likeContains('a\\b')).toBe('%a\\\\b%')
    expect(likeContains('обычный')).toBe('%обычный%')
  })
})
