import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ДИСЦИПЛИНА ЛИСТАНИЯ — два правила, которые иначе живут только в голове.
 *
 * 1. У УПОРЯДОЧЕННОЙ ВЫДАЧИ ЕСТЬ ПРЕДЕЛ. Запрос с `orderBy` и без предела растёт вместе
 *    с корпусом: пока строк сотня — незаметно, на тысячах страница поднимает тысячи строк
 *    вместе с аватарами, чтобы показать экран. Ровно так жили 37 выдач до этой работы, и
 *    ни одна из них не выглядела ошибкой в ревью.
 *
 * 2. ССЫЛКУ НА СТРАНИЦУ СТРОИТ ТОЛЬКО `pageHref`. Он переносит остальные параметры и
 *    меняет ровно номер. Рукописный `?page=` их теряет — и со второй страницы у человека
 *    молча слетает отбор. Это уже случалось: до общего построителя каждая страница
 *    собирала адрес сама, и тег с полкой не переносили ничего.
 *
 * Первое правило проверяется НА УРОВНЕ ФУНКЦИИ, а не отдельного запроса: разбирать
 * цепочки вызовов регулярками — гадание, а «эта функция чем-то ограничивает выдачу» —
 * проверяемое утверждение. Огрубление осознанное: функция с двумя запросами, где предел
 * стоит только у одного, проверку пройдёт. Ловим КЛАСС, а не каждый экземпляр.
 */

const FEATURES = 'src/features'
const APP = 'src/app'

/** Файлы запросов: где живут выдачи. */
const isQueryFile = (p: string): boolean =>
  p.endsWith('.ts') && (/quer/i.test(p) || /\/queries\//.test(p) || /(search|service|store)\.ts$/.test(p))

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

/**
 * Выдачи, ограниченные ПРИРОДОЙ СУЩНОСТИ, а не пределом в запросе.
 *
 * Это не «пока не дошли руки»: у каждой строки есть потолок, заданный смыслом. Коллабораторов
 * у списка единицы, меток — десятки, папок звёзд — сколько человек завёл руками. Добавлять
 * сюда новое можно, но с причиной, а не потому что тест мешает: если у сущности потолка нет,
 * запрос обязан его поставить.
 */
const BOUNDED_BY_NATURE: Record<string, string> = {
  'admin/feed-queries.ts::feedSourceRows': 'источники ленты — их заводят руками в админке',
  'catalogs/queries.ts::getOwnerCatalogs': 'полки одного владельца',
  'catalogs/queries.ts::getCatalogTagProfiles': 'профили тегов полки',
  'collab/queries.ts::getCollaborators': 'соредакторы списка — единицы',
  'collections/queries.ts::getCollections': 'кураторские подборки с ручным порядком',
  'collections/queries.ts::getAdminCollections': 'то же в админке',
  'comments/queries.ts::getSuggestionThreads': 'заметки ревью, сгруппированные по блокам, — не лента',
  'dig/queries.ts::digLayersFor': 'слои раскопа одной сущности',
  'generation/queries.ts::getGeneration': 'одна генерация со своими шагами',
  'issues/queries.ts::getListLabels': 'метки списка',
  'issues/queries.ts::getIssueAssignees': 'исполнители одной задачи',
  'issues/queries.ts::getIssueAssigneesFor': 'исполнители показанной страницы задач',
  'library/queries/feed.ts::getPinnedTemplates': 'закреплённые владельцем на профиле',
  'library/queries/list.ts::getVersions': 'выпадающий список версий и сборка changelog — агрегат, не выдача',
  'library/queries/suggestions.ts::getSuggestionsAssignees': 'исполнители показанной страницы правок',
  'library/saved-queries.ts::listSavedQueries': 'сохранённые запросы человека',
  'mcp/queries.ts::getApiTokens': 'токены человека',
  'milestones/queries.ts::getMilestones': 'вехи списка',
  'milestones/queries.ts::getMilestonesForPicker': 'то же для пикера',
  'runs/queries.ts::getRun': 'один прогон со своими шагами',
  'sessions/queries.ts::getOnlineUsers': 'окно по времени: кто активен за последние минуты',
  'star-folders/queries.ts::getUserFolders': 'папки звёзд человека',
  'transfer/queries.ts::getIncomingTransfers': 'входящие передачи человека',
}

/**
 * Чем функция может ограничивать выдачу.
 *
 * `limit:` — форма реляционных запросов drizzle (`findMany({ limit })`), и её приходится
 * отличать от АННОТАЦИИ ТИПА: у функции с окном в сигнатуре стоит `window?: { limit:
 * number }`, и наивная проверка засчитывала это за предел. Мутация («убрать предел у
 * обсуждений») тогда проходила незамеченной — сторож молчал ровно там, где обязан кричать.
 *
 * Просмотр вперёд стоит СРАЗУ за двоеточием и сам съедает пробелы. Вынесенный за `\s*`
 * он не работает вовсе: движок откатывает `\s*` до нуля символов, проверяет `" number"`,
 * не видит там слова `number` — и пропускает. На этом сторож молчал во второй раз.
 */
const BOUNDS = [/\.limit\(/, /feedWindow\(/, /probeLimit\(/, /\blimit:(?!\s*(?:number|string)\b)/]

/** Упорядоченные выдачи без предела: `путь::имя`. */
const unbounded = (): string[] => {
  const out: string[] = []
  for (const path of walk(FEATURES).filter(isQueryFile)) {
    const src = readFileSync(path, 'utf8')
    const rel = path.slice(FEATURES.length + 1)
    for (const m of src.matchAll(/export (?:async )?function (\w+)/g)) {
      const start = m.index ?? 0
      const next = src.indexOf('\nexport ', start + 1)
      const body = src.slice(start, next === -1 ? undefined : next)
      if (!body.includes('.orderBy(') && !body.includes('orderBy:')) continue
      if (BOUNDS.some((b) => b.test(body))) continue
      out.push(`${rel}::${m[1]}`)
    }
  }
  return out.sort()
}

describe('дисциплина листания', () => {
  it('у упорядоченной выдачи есть предел — или причина в списке исключений', () => {
    const unknown = unbounded().filter((k) => !(k in BOUNDED_BY_NATURE))
    expect(unknown).toEqual([])
  })

  it('список исключений не протух: в нём нет того, чего больше нет', () => {
    // Иначе он превращается в свалку: функцию починили или удалили, а строка осталась и
    // молча разрешает будущую одноимённую.
    const actual = new Set(unbounded())
    expect(Object.keys(BOUNDED_BY_NATURE).filter((k) => !actual.has(k))).toEqual([])
  })

  it('проверка не выродилась: упорядоченные выдачи в features вообще есть', () => {
    const withOrder = walk(FEATURES)
      .filter(isQueryFile)
      .filter((p) => readFileSync(p, 'utf8').includes('orderBy'))
    expect(withOrder.length).toBeGreaterThan(20)
  })

  it('ссылку на страницу строит только pageHref', () => {
    // Рукописный `?page=` теряет остальные параметры, и со второй страницы у человека
    // молча слетает отбор. Исключение одно — сам построитель.
    const handmade = walk('src')
      .filter((p) => /\.tsx?$/.test(p) && p !== join('src', 'shared', 'lib', 'paging.ts'))
      .flatMap((p) =>
        readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => ({ line: line.trim(), n: i + 1 }))
          .filter(({ line }) => line.includes('?page=') && !line.startsWith('//') && !line.startsWith('*'))
          .map(({ line, n }) => `${p}:${n} ${line}`),
      )
    expect(handmade).toEqual([])
  })
})

/**
 * ТРЕТЬЕ ПРАВИЛО: у страницы с листалкой canonical указывает НА СЕБЯ.
 *
 * Страница 2 обязана канонизировать `?page=2`. Указать на первую — значит сказать
 * обходчику «всё содержимое уже описано там», и списки со второй страницы не попадают
 * в индекс вовсе: их канонический адрес показывает другое.
 *
 * Проверяется КЛАСС: если страница читает `page` из адреса и объявляет canonical, тот
 * обязан строиться через `canonicalPage`. Рукописная строка тем и опасна, что выглядит
 * правильной — `/tags/x` вместо `/tags/x?page=2` ошибкой не смотрится.
 */
const PAGED_WITH_CANONICAL = (): string[] => {
  const bad: string[] = []
  for (const file of walk(APP)) {
    if (!file.endsWith('page.tsx')) continue
    const src = readFileSync(file, 'utf8')
    if (!/pageFromParam\(/.test(src)) continue // листалки нет — правило не о ней
    if (!/canonical:/.test(src)) continue // canonical не объявлен — это другое правило
    if (!/canonicalPage\(/.test(src)) bad.push(file.slice(file.indexOf('src/')))
  }
  return bad
}

describe('canonical листалки указывает на себя', () => {
  it('страницы с номером страницы строят canonical через canonicalPage', () => {
    expect(PAGED_WITH_CANONICAL(), 'canonical со страницы листалки обязан нести свой ?page=').toEqual([])
  })
})
