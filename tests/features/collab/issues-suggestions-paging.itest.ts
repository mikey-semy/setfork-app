import { beforeEach, describe, expect, it } from 'vitest'
import { pageWindow } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАДАЧИ И ПРАВКИ — Фаза 2: номера страниц, а не курсор.
 *
 * Это КАТАЛОГИ, а не ленты: их фильтруют, сортируют и прыгают по ним, а новые строки
 * приходят с краю нумерации, не в середину, — поэтому смещение здесь верно.
 *
 * Главное, что проверяется, — СЧЁТ И ВЫДАЧА НЕ РАЗЪЕЗЖАЮТСЯ. Число страниц берётся из
 * счёта, и разойдись он с выдачей хоть на одно условие отбора, листалка нарисует
 * страницы, которых нет, либо спрячет существующие. Обе функции при этом по отдельности
 * выглядят верными, поэтому проверка идёт ПАРОЙ: обход по страницам обязан дать ровно
 * столько строк, сколько насчитал счёт.
 */

const { db, issues, milestones, suggestions, templates, users } = await import('@/shared/db')
const { countListIssues, getIssues } = await import('@/features/issues/queries')
const { countSuggestions, getSuggestions } = await import('@/features/library/queries')

const OPEN = 7
const CLOSED = 3
const PER = 3
let templateId = ''

beforeEach(async () => {
  await resetTables([issues, suggestions, milestones, templates, users])
  const [u] = await db.insert(users).values({ handle: 'cat-owner' }).returning({ id: users.id })
  const [g] = await db.insert(users).values({ handle: 'cat-guest' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'catalog-list', title: { ru: 'к' } })
    .returning({ id: templates.id })
  templateId = tpl.id

  await db.insert(issues).values([
    ...Array.from({ length: OPEN }, (_, i) => ({
      templateId,
      number: i + 1,
      title: i % 2 === 0 ? `вопрос про кран ${i}` : `иное ${i}`,
      authorId: u.id,
      status: 'open' as const,
    })),
    ...Array.from({ length: CLOSED }, (_, i) => ({
      templateId,
      number: OPEN + i + 1,
      title: `закрытый ${i}`,
      authorId: u.id,
      status: 'closed' as const,
    })),
  ])

  await db.insert(suggestions).values(
    Array.from({ length: OPEN }, (_, i) => ({
      templateId,
      authorId: i % 2 === 0 ? u.id : g.id,
      baseVersion: 1,
      note: `правка ${i}`,
      // ОДНО время на все: порядок держится только доопределением до id. С разными
      // датами тест был бы зелёным и при полностью убранном доопределении.
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, 0)),
    })),
  )
})

/** Обход всех страниц: сколько строк набралось и не повторились ли. */
const walk = async <T extends { id: string }>(
  fetch: (w: { limit: number; offset: number }) => Promise<T[]>,
  total: number,
): Promise<string[]> => {
  const seen: string[] = []
  const pages = Math.max(1, Math.ceil(total / PER))
  for (let p = 1; p <= pages; p++) seen.push(...(await fetch(pageWindow(p, PER))).map((r) => r.id))
  return seen
}

describe('задачи и правки листаются страницами', () => {
  it('задачи: счёт и выдача считают ОДИН отбор', async () => {
    const query = { status: 'open' as const }
    const total = await countListIssues(templateId, query)
    expect(total).toBe(OPEN)
    const seen = await walk((w) => getIssues(templateId, query, w), total)
    expect(seen).toHaveLength(OPEN)
    expect(new Set(seen).size).toBe(OPEN)
  })

  it('задачи: отбор по слову учитывается И в счёте, И в выдаче', async () => {
    // Разойдись они здесь — обход дал бы не столько строк, сколько обещал счёт.
    const query = { status: 'open' as const, q: 'кран' }
    const total = await countListIssues(templateId, query)
    expect(total).toBe(4) // чётные из семи
    const seen = await walk((w) => getIssues(templateId, query, w), total)
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
  })

  it('задачи: закрытые считаются отдельно от открытых', async () => {
    expect(await countListIssues(templateId, { status: 'closed' })).toBe(CLOSED)
    expect(await countListIssues(templateId, { status: 'open' })).toBe(OPEN)
  })

  it('правки: страницы не теряют и не дублируют строк при РАВНОМ времени', async () => {
    // Все правки созданы одним мгновением: порядок однозначен только доопределением
    // до id, и без него соседние страницы показали бы одну строку дважды.
    const query = { status: 'open' as const }
    const total = await countSuggestions(templateId, query)
    expect(total).toBe(OPEN)
    const seen = await walk((w) => getSuggestions(templateId, query, w), total)
    expect(seen).toHaveLength(OPEN)
    expect(new Set(seen).size).toBe(OPEN)

    // ПРОВЕРЯЕМ САМ ПОРЯДОК, а не только уникальность. На семи строках база стабильно
    // отдаёт heap-порядок, поэтому обход сходится и БЕЗ доопределения — уникальность
    // здесь не доказывает ничего (то же и с «повтор дал то же самое»). Доказывает
    // совпадение с ОЖИДАЕМЫМ порядком: время у всех равно, значит порядок обязан
    // задаваться id по возрастанию, а вставлялись строки не в этом порядке.
    expect(seen).toEqual([...seen].sort())
  })

  it('правки: отбор по автору учитывается И в счёте, И в выдаче', async () => {
    // Счёт правок соединяется с `users` ради этого фильтра; забудь он join — разошёлся
    // бы с выдачей ровно здесь.
    const query = { status: 'open' as const, author: 'cat-guest' }
    const total = await countSuggestions(templateId, query)
    expect(total).toBe(3) // нечётные из семи
    const seen = await walk((w) => getSuggestions(templateId, query, w), total)
    expect(seen).toHaveLength(total)
  })

  it('окно режется в ЗАПРОСЕ: страница отдаёт ровно свой размер', async () => {
    const first = await getIssues(templateId, { status: 'open' }, pageWindow(1, PER))
    const last = await getIssues(templateId, { status: 'open' }, pageWindow(3, PER))
    expect(first).toHaveLength(PER)
    expect(last).toHaveLength(OPEN - PER * 2) // хвост короче страницы
  })

  it('шаблонные знаки в запросе — БУКВЫ, а не язык шаблонов', async () => {
    // `%` и `_` — подстановочные знаки. Пока шаблон строился руками, `?q=%` возвращал ВСЕ
    // задачи (фильтр не фильтровал), а `?q=_b` находил «ab». Проверено на живой базе до
    // правки. Здесь проверяется, что экранирование доезжает до SQL, а не только живёт в
    // помощнике.
    expect(await countListIssues(templateId, { status: 'open', q: '%' })).toBe(0)
    expect(await countListIssues(templateId, { status: 'open', q: '_' })).toBe(0)
    // Осмысленный запрос при этом работает по-прежнему.
    expect(await countListIssues(templateId, { status: 'open', q: 'кран' })).toBe(4)
  })

  it('битое окно роняет запрос, а не превращается в полный скан', async () => {
    // Драйвер молча выбрасывает непригодный предел, и выдача становится безразмерной —
    // ровно та ошибка, из-за которой главная отдавала 518 списков.
    await expect(getIssues(templateId, { status: 'open' }, { limit: 0 })).rejects.toThrow(TypeError)
    await expect(getSuggestions(templateId, {}, { limit: 2.5 })).rejects.toThrow(TypeError)
  })
})
