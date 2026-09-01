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
 * Проверяется КЛАСС: своя разметка ПОКАЗА рядом с подстановкой команды. Признак разметки
 * шире, чем `font-mono`: перенос, обрезка и голые `<code>`/`<pre>` — это ровно те четыре
 * способа, которыми места и разъехались. Окно в шесть строк, а не одна: у половины
 * разъехавшихся мест `className` и `{it.command}` стояли на разных строках, и проверка
 * «в одной строке» поймала бы одно место из шести (проверено откатом каждого).
 *
 * ⚠️ ИСКЛЮЧЕНИЯ ПЕРЕЧИСЛЕНЫ ПОИМЁННО, а не разрешены по признаку. Признак («тут
 * особый случай») отключает проверку у всякого, кто так подумает; список требует
 * назвать место и причину:
 *  • `CodeCard` — печать и код внутри текста: там прокрутки нет физически;
 *  • `ConflictResolver` — превью стороны конфликта, где обрезаны ВСЕ поля;
 *  • `DiffViews` — строка «было → стало»: предмет не команда, а её изменение.
 *
 * ⚠️ ЧЕГО ПРАВИЛО НЕ ЛОВИТ, ЧТОБЫ НА НЕГО НЕ НАДЕЯЛИСЬ ЛИШНЕГО: выбор НЕ ТОГО общего
 * показа. `CodeCard` на экране (было в `SuggestionResult`) — легальный компонент, и
 * строка с ним считается чистой. Правило стережёт только рукотворную разметку; какой из
 * трёх показов уместен, решает место вызова и обязано это назвать комментарием.
 */
const ALLOWED = new Set([
  'src/shared/ui/CommandText.tsx',
  'src/shared/ui/CopyRow.tsx',
  'src/shared/ui/CodeCard.tsx',
  'src/features/git/ConflictResolver.tsx',
  'src/features/library/DiffViews.tsx',
])

/** Своя разметка показа: шрифт, перенос, обрезка или голый элемент кода. */
const HANDMADE = /font-mono|whitespace-(pre|normal|nowrap)|truncate|break-(all|words)|<code|<pre/
/**
 * Подстановка САМОГО значения: `{it.command}`, `{step.command && (`, `value={s.command}`.
 * После `command` разрешены только конец подстановки, `&&` и `?` — иначе правило считало
 * показом и `{LANG_LABEL[detectLang(it.command)]}`, где показывают метку языка, а команда
 * лишь аргумент.
 */
const RENDERS = /\.command\s*(\}|&&|\?)|\bcommand=\{/
/** Общий показ. Строка с ним чиста, даже если рядом стоит своя моноширинная мелочь
 *  (в `CandidateCard` соседний бейдж языка — тоже `font-mono`, но показывает не команду). */
const SHARED = /\b(CommandText|CopyRow|CodeCard)\b/
/** Строк вокруг подстановки, где ищется разметка: className и значение часто разнесены. */
const WINDOW = 6

describe('команда показывается одним способом', () => {
  it('моноширинной разметки с командой мимо общего показа нет', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!file.endsWith('.tsx')) continue
      const rel = relSrc(file)
      if (ALLOWED.has(rel)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      const code = lines.map((l) => {
        const t = l.trimStart()
        // Комментарии описывают решения и сами называют признаки — по ним не судим.
        return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : l
      })
      for (const [i, line] of code.entries()) {
        if (!RENDERS.test(line) || SHARED.test(line)) continue
        const near = code.slice(Math.max(0, i - WINDOW), i + WINDOW + 1)
        if (near.some((l) => HANDMADE.test(l))) offenders.push(`${rel}:${i + 1}`)
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
