import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * БАЗА ПРАВКИ — пять сторожей вокруг одного предмета, и у каждого свой докблок ниже:
 *   1. запись версии называет базу либо объясняет, почему не называет;
 *   2. обёртка садовника: базу передают ВСЕ вызывающие;
 *   3. тесты зовут пишущие инструменты, называя базу (приведение её прятало);
 *   4. число контракта считается одним правилом и ровно в объявленных точках;
 *   5. отказ садовника по гонке не теряется в журнале.
 *
 * Все они текстовые и работают БЕЗ БАЗЫ ДАННЫХ — там, где интеграционное окружение
 * поднять нельзя, а проверить надо.
 */

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

/**
 * ВЫЗОВ ПИШУЩЕГО ИНСТРУМЕНТА В ТЕСТЕ НАЗЫВАЕТ БАЗУ.
 *
 * Когда `baseVersion` стал обязательным, поправить пришлось три файла тестов. Два нашла
 * типизация — она ткнула в каждый вызов. Третий (`git-parity.itest.ts`) промолчал: вызов
 * там стоял с `as never`, а приведение прячет отсутствие поля от tsc. Узнать о поломке
 * можно было только прогоном с живым ядром, до которого в тот день не дошло. Тот же
 * корень, что у K41: починили два места, третье не показалось.
 *
 * Проверка текстовая и БЕЗ БАЗЫ: она смотрит на форму вызова, а не на его результат, — и
 * потому работает там, где интеграционное окружение поднять нельзя.
 *
 * Правила «не приводить аргументы к never» здесь намеренно НЕТ, хотя соблазн прямой.
 * Такие приведения в тестах стоят по другой причине — союз операций `patch_list` тяжело
 * удовлетворить на месте, — и запрет числил бы законное нарушением. Ловим ровно то, что
 * сломалось: отсутствие обязательного поля. Оно ловится точно и независимо от приведений.
 */
describe('тесты зовут запись списка, называя базу', () => {
  const TESTS = new URL('..', import.meta.url).pathname
  const calls = walk(TESTS)
    .map((file) => ({ rel: relative(TESTS, file), text: readFileSync(file, 'utf8') }))
    // Сам сторож содержит имена инструментов строками — иначе он нашёл бы себя.
    .filter(({ rel }) => rel !== relative(TESTS, new URL(import.meta.url).pathname))
    .flatMap(({ rel, text }) =>
      ['mcpUpdateList(', 'mcpPatchList('].flatMap((needle) => callArgs(text, needle).map((args) => ({ rel, needle, args }))),
    )

  it('вызовы вообще находятся — иначе проверять нечего', () => {
    expect(calls.length).toBeGreaterThanOrEqual(10)
  })

  it('каждый вызов несёт baseVersion', () => {
    const silent = calls.filter((c) => !/baseVersion/.test(c.args)).map((c) => `${c.rel}: ${c.needle}`)
    expect(silent, 'обязательное поле пропущено — и приведение в аргументах прячет это от tsc').toEqual([])
  })
})

/**
 * НОМЕР ТЕКУЩЕЙ ВЕРСИИ У MCP СЧИТАЕТСЯ В ОДНОМ МЕСТЕ.
 *
 * Формула «строка версии, а если её нет — самая свежая» жила копиями: одна у чтения, одна
 * у патча, а полная замена сверялась просто с колонкой. Пока копий было две, они молчали;
 * третий вариант дал ложный отказ по числу, которое сам же `get_list` и выдал.
 *
 * Сторож ловит появление ЧЕТВЁРТОГО варианта: считать этот номер вправе только
 * `base-version.ts`.
 */
describe('текущая версия у MCP считается одним правилом', () => {
  const OWNER = 'features/mcp/tools/lists/base-version.ts'
  const MCP = new URL('../../src/features/mcp', import.meta.url).pathname
  const SRC_ROOT = new URL('../../src', import.meta.url).pathname
  // Признак СВОЕЙ арифметики: падение на колонку `currentVersion` через `??`.
  const OWN_FORMULA = /\?\?\s*[\w.]*\btpl\.currentVersion\b/

  it('своя формула есть только у владельца правила', () => {
    const rogue = walk(MCP)
      .filter((f) => relative(SRC_ROOT, f) !== OWNER)
      .filter((f) => OWN_FORMULA.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC_ROOT, f))
    expect(rogue, 'номер текущей версии считается мимо headVersion — контракт разъедется молча').toEqual([])
  })

  /**
   * ГДЕ ИМЕННО число контракта покидает сервер или сверяется с присланным. Перечень
   * ТОЧНЫЙ, а не «не меньше трёх»: порог пропускает ровно ту беду, от которой заведён, —
   * место, которое перестало звать общее правило, пока другое его позвало. Убыло или
   * прибыло — таблица правится осознанно, как ROUTES выше.
   */
  const CONTRACT_POINTS: Record<string, number> = {
    // `get_list` НАЗЫВАЕТ число агенту — с него всё и начинается.
    'tools/reads.ts': 1,
    // Полная замена и патч СВЕРЯЮТ присланное, предпросмотр публикации называет следующее.
    'tools/lists/edit.ts': 3,
  }

  it('правило зовут ровно там, где число контракта выходит наружу или сверяется', () => {
    // Считаем ВЫЗОВЫ, а не файлы: три точки живут в одном файле, и по файлам «все на
    // месте» выглядело бы так же, как «одна из трёх забыла».
    const actual: Record<string, number> = {}
    for (const f of walk(MCP)) {
      const n = callArgs(readFileSync(f, 'utf8'), 'headVersion(').length
      if (n) actual[relative(MCP, f)] = n
    }
    expect(actual, 'число контракта считают не там, где объявлено').toEqual(CONTRACT_POINTS)
  })
})

/**
 * ОТКАЗ САДОВНИКА ПО ГОНКЕ ПОПАДАЕТ В ЖУРНАЛ — все три раза.
 *
 * Проход отказывается писать версию в трёх местах: прямая правка своего списка,
 * авто-мёрдж на кураторском и рост живой ленты. Журнал — единственный наблюдатель у
 * фонового прохода: по нему считается «День компании» и правило остановки, и незаписанная
 * ветка выглядит в нём не отказом, а тишиной. Третья ветка ровно так и выпала — гонка
 * уходила наружу тем же значением, что и сбой модели, и в журнале не оставляла ничего.
 *
 * Сторож текстовый и без базы: он смотрит, что у КАЖДОЙ ветки «список ушёл вперёд» внутри
 * стоит запись в журнал, а не на то, что окажется в таблице после прогона.
 */
describe('гонка садовника не теряется в журнале', () => {
  const GARDENER = new URL('../../src/features/gardener', import.meta.url).pathname

  /**
   * Тело ветки, начинающейся сразу за маркером.
   *
   * Однострочная ветка (`if (…) return 'stale'`) фигурных скобок не имеет вовсе, и поиск
   * ближайшей `{` уехал бы в СОСЕДНИЙ код — сторож читал бы чужое тело и молчал бы о
   * настоящем. Поэтому сначала смотрим, есть ли скобка на этой же строке.
   */
  function branchBody(text: string, at: number): string {
    const eol = text.indexOf('\n', at)
    const line = text.slice(at, eol < 0 ? text.length : eol)
    if (!line.includes('{')) return line
    const open = text.indexOf('{', at)
    if (open < 0) return line
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) return text.slice(open, i + 1)
      }
    }
    return line
  }

  const branches = walk(GARDENER).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const out: { rel: string; body: string }[] = []
    const re = /===\s*'stale'/g
    for (let m = re.exec(text); m; m = re.exec(text)) out.push({ rel: relative(GARDENER, file), body: branchBody(text, m.index) })
    return out
  })

  /**
   * ГДЕ ИМЕННО проход умеет отказаться писать версию. Счёт ТОЧНЫЙ, а не «не меньше»:
   * порог пропускает ровно то, от чего сторож заведён. Первая его редакция проверяла
   * «каждая найденная ветка журналирует» — и молча позеленела, когда ветку просто
   * удалили: проверять стало нечего. Удаление теперь так же шумно, как немота.
   */
  const STALE_BRANCHES: Record<string, number> = {
    // Прямая правка своего списка, авто-мёрдж на кураторском, рост живой ленты.
    'service.ts': 3,
    // Отдаёт исход наверх — журналирует проход, у которого есть общий помощник.
    'sweep/living.ts': 1,
    // Сам отказ: превращает исключение ядра в значение, которым можно ветвиться.
    'sweep/publish.ts': 1,
  }

  it('ветки отказа на месте и их ровно столько, сколько объявлено', () => {
    const actual: Record<string, number> = {}
    for (const b of branches) actual[b.rel] = (actual[b.rel] ?? 0) + 1
    expect(actual, 'ветка отказа исчезла или завелась новая — исход прохода перестал сходиться').toEqual(STALE_BRANCHES)
  })

  /**
   * ЧЕМ отказ перестаёт быть тишиной — три названных способа, а не одно написание.
   *
   * Первая редакция знала ровно `journal(` — и упала на ЗЕЛЁНОМ коде, когда прямой вызов
   * заменили общим помощником «предложение ждёт человека» (он и уведомляет владельца, и
   * пишет в журнал). Сторож был прав по форме и неправ по существу: правило описывало
   * написание, а не свойство. Способы теперь перечислены и названы.
   */
  const RECORDED = /journal\(|leaveSuggestionOpen\(|return\s*\{\s*result:\s*'stale'|return 'stale'/

  it('каждая ветка записывает исход сама, через помощника или отдаёт его наверх', () => {
    const mute = branches.filter((b) => !RECORDED.test(b.body)).map((b) => b.rel)
    expect(mute, 'отказ прохода виден в журнале как тишина — его не отличить от «ничего не делали»').toEqual([])
  })
})
