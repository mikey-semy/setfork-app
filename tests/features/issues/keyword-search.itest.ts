import { gt } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОИСК ЗАДАЧ ИЩЕТ ТАМ, ГДЕ ЛЮДИ ПИШУТ.
 *
 * Раньше смотрели только заголовок, а суть задачи почти всегда в теле или в ответе:
 * «Проблема со списком» в заголовке, «не открывается на телефоне» — в описании, решение —
 * в третьей реплике. Человек искал своё же слово и не находил своей задачи.
 *
 * Форма из исходников Gitea (`modules/indexer/issues/db/db.go`): заголовок ИЛИ тело ИЛИ
 * реплики ИЛИ точный номер; слова внутри одного поля соединяются И.
 */
const { db, issueComments, issues, templates, users } = await import('@/shared/db')
const { getIssues, countListIssues } = await import('@/features/issues/queries')
const { countIssues, searchIssues } = await import('@/features/issues/search')

let templateId = ''

const seed = async (): Promise<void> => {
  await resetTables([issueComments, issues, templates, users])
  const [u] = await db.insert(users).values({ handle: 'search-author' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'search-list', title: { ru: 'с' }, status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  templateId = tpl.id

  const rows = [
    { number: 1, title: 'Проблема со списком', body: 'не открывается на телефоне' },
    { number: 2, title: 'Кнопка сохранения', body: 'обычное описание' },
    { number: 3, title: 'Третья задача', body: 'пусто' },
    // Ловушка экранирования: 100% — это не шаблон, а текст.
    { number: 4, title: 'Скидка 100% на первый месяц', body: 'текст' },
  ]
  const ids = await db
    .insert(issues)
    .values(rows.map((r) => ({ templateId, number: r.number, title: r.title, body: r.body, authorId: u.id })))
    .returning({ id: issues.id, number: issues.number })
  const byNumber = new Map(ids.map((r) => [r.number, r.id]))
  await db.insert(issueComments).values([
    { issueId: byNumber.get(3)!, authorId: u.id, body: 'починили через кэш, telegram тут ни при чём' },
  ])
}

const found = async (q: string): Promise<number[]> => {
  const rows = await getIssues(templateId, { status: 'open', q, sort: 'oldest' }, { limit: 50 })
  return rows.map((r) => r.number)
}

beforeEach(seed)

describe('где ищет поиск задач', () => {
  it('в заголовке — как и раньше', async () => {
    expect(await found('кнопка')).toEqual([2])
  })

  it('в теле — то, ради чего всё затевалось', async () => {
    expect(await found('телефоне')).toEqual([1])
  })

  it('в репликах: решение чаще лежит в ответе, чем в описании', async () => {
    expect(await found('telegram')).toEqual([3])
  })

  it('по номеру — только если запрос целиком из цифр', async () => {
    expect(await found('2')).toEqual([2])
    // «2я» не должно поднимать задачу №2: это текст, а не номер.
    expect(await found('2я')).toEqual([])
  })

  it('слова соединяются И внутри одного поля, а не ИЛИ', async () => {
    expect(await found('не открывается'), 'оба слова в теле — находим').toEqual([1])
    // «кнопка» в заголовке №2, «телефоне» в теле №1 — общей задачи нет.
    expect(await found('кнопка телефоне'), 'слова из разных задач не должны склеиваться').toEqual([])
  })

  it('подстановочные знаки — это текст запроса, а не шаблон', async () => {
    expect(await found('100%'), 'экранирование LIKE').toEqual([4])
    // Один знак «%» — это поиск БУКВАЛЬНОГО процента, поэтому находится только задача,
    // где он написан. Без экранирования тот же запрос вернул бы все четыре: шаблон
    // `%%%` означает «что угодно» (так и было на живой базе 19.08, см. shared/db/like).
    expect(await found('%')).toEqual([4])
  })

  it('счёт и выдача считаются по одному отбору', async () => {
    // ⚠️ Разойдись они — листалка нарисует страницы, которых нет. Ошибка тихая: обе
    // цифры по отдельности выглядят верными.
    for (const q of ['телефоне', 'telegram', 'кнопка телефоне']) {
      expect(await countListIssues(templateId, { status: 'open', q }), `запрос «${q}»`).toBe((await found(q)).length)
    }
  })
})

describe('счётчик у переключателя областей', () => {
  /**
   * ⚠️ БЕЙДЖ СЧИТАЛ ВСЕ СОСТОЯНИЯ, А ПОКАЗЫВАЛИСЬ ОТКРЫТЫЕ.
   *
   * На запрос, где одна задача открыта, а остальные закрыты, переключатель обещал
   * четыре, список показывал одну. По этой же цифре считается число страниц — то есть
   * листалка рисовала страницы, за которыми ничего нет.
   */
  const page = { limit: 50 }

  it('обещанное число совпадает с показанным — по каждому состоянию', async () => {
    await db.update(issues).set({ status: 'closed' }).where(gt(issues.number, 1))
    for (const state of ['open', 'closed', 'all'] as const) {
      const found = await searchIssues({ state, window: page })
      expect(found.total, `состояние «${state}»`).toBe(found.items.length)
      // Бейдж переключателя считается отдельным запросом — он обязан обещать столько же.
      expect(await countIssues(undefined, state), `бейдж, состояние «${state}»`).toBe(found.total)
    }
  })

  it('то же и со словом запроса: счёт и выдача — один отбор', async () => {
    await db.update(issues).set({ status: 'closed' }).where(gt(issues.number, 1))
    for (const q of ['телефоне', 'telegram', 'задача']) {
      const found = await searchIssues({ q, state: 'all', window: page })
      expect(found.total, `запрос «${q}»`).toBe(found.items.length)
      expect(await countIssues(q, 'all'), `бейдж, запрос «${q}»`).toBe(found.total)
    }
  })

  it('вторая страница отдаёт продолжение, а не то же самое', async () => {
    const first = await searchIssues({ state: 'all', window: { limit: 2 } })
    const second = await searchIssues({ state: 'all', window: { limit: 2, offset: 2 } })
    expect(first.items).toHaveLength(2)
    const firstNumbers = first.items.map((r) => r.number)
    expect(second.items.some((r) => firstNumbers.includes(r.number)), 'вторая страница повторяет первую').toBe(false)
    // Объём не зависит от окна: он про весь отбор, а не про показанную порцию.
    expect(first.total).toBe(4)
  })
})
