import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walkSrc, relSrc } from '../helpers/walk-src'

/**
 * КОМАНДА ШАГА ПОКАЗЫВАЕТСЯ ОДНИМ СПОСОБОМ.
 *
 * Одно поле `step.command` рисовалось ШЕСТЬЮ разметками: где-то перенос по словам,
 * где-то прокрутка, где-то голый `<code>` вообще без классов, где-то обрезка. Отсюда и
 * жалоба владельца «на мобильном код переносится, хотя мы это исправляли» — исправляли
 * в одном месте из шести, и каждое следующее место чинилось заново.
 *
 * Проверяется КЛАСС: моноширинная разметка, в которую подставляют команду, обязана идти
 * через общий показ (`CommandText`, либо `CopyRow`/`CodeCard`, которые на нём построены
 * или названы исключением).
 *
 * ⚠️ ИСКЛЮЧЕНИЯ ПЕРЕЧИСЛЕНЫ ПОИМЁННО, а не разрешены по признаку. Признак («тут
 * особый случай») отключает проверку у всякого, кто так подумает; список требует
 * назвать место и причину:
 *  • `CodeCard` — печать и код внутри текста: там прокрутки нет физически;
 *  • `ConflictResolver` — превью стороны конфликта, где обрезаны ВСЕ поля;
 *  • `DiffViews` — строка «было → стало»: предмет не команда, а её изменение.
 */
const ALLOWED = new Set([
  'src/shared/ui/CommandText.tsx',
  'src/shared/ui/CopyRow.tsx',
  'src/shared/ui/CodeCard.tsx',
  'src/features/git/ConflictResolver.tsx',
  'src/features/library/DiffViews.tsx',
])

/** Разметка с моноширинным шрифтом, куда подставляют команду. */
const HANDMADE = /font-mono/

describe('команда показывается одним способом', () => {
  it('моноширинной разметки с командой мимо общего показа нет', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!file.endsWith('.tsx')) continue
      const rel = relSrc(file)
      if (ALLOWED.has(rel)) continue
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        const t = line.trimStart()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
        // Своя разметка = font-mono в той же строке, где подставляется команда.
        if (HANDMADE.test(line) && /\bcommand\b/.test(line)) offenders.push(`${rel}:${i + 1}`)
      }
    }
    expect(offenders, 'команду показывает CommandText — иначе поведение разъедется снова').toEqual([])
  })

  it('проверке есть что проверять', () => {
    // Анти-вырождение: список исключений мог бы разрастись до «всех», и проверка стала
    // бы зелёной, ничего не проверяя.
    const files = walkSrc(new URL('../../src', import.meta.url).pathname).filter((f) => f.endsWith('.tsx'))
    expect(files.length, 'исходников не найдено — проверка выше проверяет пустоту').toBeGreaterThan(100)
    expect(ALLOWED.size, 'исключений стало больше, чем мест показа — это уже не исключения').toBeLessThan(8)
  })
})
