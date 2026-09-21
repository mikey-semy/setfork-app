import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * КАЖДАЯ ЗАПИСЬ ВЕРСИИ ЛИБО НАЗЫВАЕТ СВОЮ БАЗУ, ЛИБО ОБЪЯСНЯЕТ, ПОЧЕМУ НЕ НАЗЫВАЕТ.
 *
 * Механизм сверки (`expectedVersion` → ядро сравнивает с текущей версией ВНУТРИ
 * транзакции, где строка списка уже взята `for update`) существует давно и работает
 * по-настоящему. Беда была не в нём, а в том, что применяли его ВЫБОРОЧНО: публикация
 * черновика и `patch_list` базу называли, а перевод, проход садовника и `update_list` —
 * нет, и при гонке молча побеждала последняя запись. Узнать, у кого защиты нет, было
 * неоткуда: пустая клетка выглядит точно так же, как обдуманное решение.
 *
 * Поэтому здесь перечислено ДОПУСТИМОЕ, а не найденное. Новый маршрут записи версии
 * обязан попасть в таблицу осознанно — с базой или с причиной, почему её здесь не
 * бывает. Причина обязательна и живёт в ДВУХ местах: словом здесь и комментарием рядом
 * с самим вызовом (иначе следующий читающий код решит, что про базу забыли, и «починит»
 * маршрут, которому отказ противопоказан).
 *
 * Почему проверка по тексту, а не по поведению: маршрутов восемь, у каждого своя
 * фикстура (живое ядро, платная модель, сессия человека), и набор поведенческих тестов
 * покрыл бы не все входы. Текст ловит ровно то, ради чего тест заведён, — ПОЯВЛЕНИЕ
 * девятого маршрута мимо решения.
 */

const SRC = new URL('../../src', import.meta.url).pathname

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Текст аргументов вызова `needle` — со счётом скобок, а не до первой закрывающей:
 *  у всех наших вызовов внутри есть и объекты, и вложенные вызовы. */
function callArgs(text: string, needle: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) return out
    let depth = 0
    let i = at + needle.length - 1
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    out.push(text.slice(at, i + 1))
    from = i + 1
  }
}

/**
 * Маршруты записи версии и решение по каждому.
 *
 * `'base'` — база передаётся в ядро. Строка — причина, по которой её здесь не бывает;
 * она обязана быть содержательной, а не отпиской.
 */
const ROUTES: Record<string, 'base' | string> = {
  'features/library/draft.ts': 'base',
  'features/mcp/tools/lists/write.ts': 'base',
  'features/library/actions/ai.ts': 'base',
  'features/gardener/sweep/publish.ts': 'base',
  'features/library/suggestion-core/apply.ts':
    'база предложения почти всегда отстаёт от текущей версии — это норма, а не гонка: принимает человек, зная, что состав заменится целиком (у нас устаревшая база warn, у GitHub и Gitea PR от старой базы тоже сливается). Вместо отказа обе версии едут наружу, и про них сказано агенту',
  'features/library/actions/versions.ts':
    'откат основан на НАЗВАННОЙ версии N, а не на прочитанной: «пусть содержимым снова станет v3» осмысленно при любой текущей, и отбрасывание всего после v3 — объявленная семантика действия, а не потеря',
}

const found = walk(SRC)
  .map((file) => ({ rel: relative(SRC, file), text: readFileSync(file, 'utf8') }))
  .flatMap(({ rel, text }) => callArgs(text, 'listStore.addVersion(').map((args) => ({ rel, args, text })))

describe('запись версии называет базу или объясняет, почему не называет', () => {
  it('сканер вообще видит маршруты — иначе «ноль нарушений» ничего не значит', () => {
    // Контроль к самому себе: пустая выборка прошла бы все проверки ниже.
    expect(found.length, 'ни одного вызова listStore.addVersion — сканер смотрит не туда').toBeGreaterThanOrEqual(
      Object.keys(ROUTES).length,
    )
    expect([...new Set(found.map((f) => f.rel))].sort()).toEqual(Object.keys(ROUTES).sort())
  })

  it('каждый вызов либо несёт expectedVersion, либо стоит в списке решений', () => {
    const silent = found.filter((f) => !/expectedVersion/.test(f.args)).map((f) => f.rel)
    const undecided = silent.filter((rel) => ROUTES[rel] === 'base' || ROUTES[rel] === undefined)
    expect(
      undecided,
      'запись версии без базы: при гонке она молча вытеснит чужую работу — передай expectedVersion или впиши причину в ROUTES',
    ).toEqual([])
  })

  it('маршрут, объявленный защищённым, действительно передаёт базу', () => {
    const promised = Object.entries(ROUTES)
      .filter(([, v]) => v === 'base')
      .map(([rel]) => rel)
    const broken = promised.filter((rel) => !found.some((f) => f.rel === rel && /expectedVersion/.test(f.args)))
    expect(broken, 'в таблице стоит «base», а в коде базы нет').toEqual([])
  })

  it('у каждого исключения причина содержательна и повторена рядом с кодом', () => {
    for (const [rel, decision] of Object.entries(ROUTES)) {
      if (decision === 'base') continue
      expect(decision.length, `причина у ${rel} — отписка`).toBeGreaterThan(60)
      const text = found.find((f) => f.rel === rel)?.text ?? ''
      // Решение обязано быть видно ТАМ, где стоит код: иначе следующий читающий
      // добавит «забытый» expectedVersion и превратит норму в отказ.
      expect(/expectedVersion/.test(text), `в ${rel} нет ни слова о том, почему базы нет`).toBe(true)
    }
  })
})

/**
 * Садовник пишет версию через свою обёртку, и вызывающих у неё трое. Ровно так выглядит
 * «починили одно место, забыли второе»: типизация ловит это на сборке, но сборка молчит
 * в отчёте о тестах, а забытый третий вызывающий — это снова тихая потеря чужой правки.
 */
describe('обёртка садовника: базу называют ВСЕ вызывающие', () => {
  const calls = walk(SRC)
    .filter((f) => !f.endsWith(join('gardener', 'sweep', 'publish.ts')))
    .flatMap((file) => callArgs(readFileSync(file, 'utf8'), 'publishGardenerVersion(').map((args) => ({ rel: relative(SRC, file), args })))

  it('вызывающих не меньше трёх — иначе сканер их не нашёл', () => {
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('каждый вызов передаёт expectedVersion', () => {
    expect(calls.filter((c) => !/expectedVersion/.test(c.args)).map((c) => c.rel)).toEqual([])
  })
})
