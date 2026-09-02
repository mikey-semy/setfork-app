import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ФИЛЬТРЫ «МОИ» И «НАЗНАЧЕНО МНЕ» И ПОРЯДКИ ПО ОБНОВЛЕНИЮ И ОТВЕТАМ.
 *
 * Сортировать можно было только по номеру, а отобрать своё — никак: в списке на сотню
 * задач человек искал свои глазами. Набор порядков взят у Gitea
 * (`models/issues/issue_search.go`, `applySorts`).
 *
 * ⚠️ Каждый порядок проверяется на данных, где он ОТЛИЧАЕТСЯ от номера: иначе тест
 * зелёный при любой сортировке, потому что номера и так идут по возрастанию.
 */
const { db, issueAssignees, issueComments, issues, templates, users } = await import('@/shared/db')
const { countListIssues, getIssueCounts, getIssues } = await import('@/features/issues/queries')

let templateId = ''
let meId = ''
let otherId = ''

const at = (day: number) => new Date(Date.UTC(2026, 8, day, 12))

beforeEach(async () => {
  await resetTables([issueComments, issues, templates, users])
  const [me] = await db.insert(users).values({ handle: 'me-user' }).returning({ id: users.id })
  const [other] = await db.insert(users).values({ handle: 'other-user' }).returning({ id: users.id })
  meId = me.id
  otherId = other.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: me.id, slug: 'filters-list', title: { ru: 'с' } })
    .returning({ id: templates.id })
  templateId = tpl.id

  // Номер, автор, время обновления и число ответов НАМЕРЕННО расходятся: задача №1
  // обновлена позже всех, у №3 больше всего ответов.
  const rows = await db
    .insert(issues)
    .values([
      { templateId, number: 1, title: 'моя свежая', authorId: meId, updatedAt: at(20) },
      { templateId, number: 2, title: 'чужая старая', authorId: otherId, updatedAt: at(5) },
      { templateId, number: 3, title: 'чужая говорливая', authorId: otherId, updatedAt: at(10) },
      { templateId, number: 4, title: 'моя закрытая', authorId: meId, status: 'closed' as const, updatedAt: at(15) },
    ])
    .returning({ id: issues.id, number: issues.number })
  const byNumber = new Map(rows.map((r) => [r.number, r.id]))

  await db.insert(issueComments).values([
    { issueId: byNumber.get(3)!, authorId: meId, body: 'раз' },
    { issueId: byNumber.get(3)!, authorId: meId, body: 'два' },
    { issueId: byNumber.get(1)!, authorId: otherId, body: 'один' },
  ])
  // Назначена мне только чужая №2 — чтобы «мои» и «назначено мне» не совпали случайно.
  await db.insert(issueAssignees).values([{ issueId: byNumber.get(2)!, userId: meId }])
})

const open = async (opts: Record<string, unknown> = {}): Promise<number[]> =>
  (await getIssues(templateId, { status: 'open', ...opts }, { limit: 50 })).map((r) => r.number)

describe('кто', () => {
  it('без фильтра — все открытые', async () => {
    expect(await open()).toHaveLength(3)
  })

  it('созданные мной', async () => {
    expect(await open({ authorId: meId })).toEqual([1])
  })

  it('назначенные мне — это НЕ то же, что созданные мной', async () => {
    expect(await open({ assigneeId: meId })).toEqual([2])
  })

  it('исполнителей у задачи может быть несколько, и задача не двоится', async () => {
    // ⚠️ Соединением вместо `exists` строка размножилась бы по числу исполнителей:
    // выдача показала бы одну задачу дважды, а счёт стал бы больше выдачи.
    const [second] = await db.select({ id: issues.id }).from(issues).where(eq(issues.number, 2))
    await db.insert(issueAssignees).values([{ issueId: second.id, userId: otherId }])
    expect(await open({ assigneeId: meId })).toEqual([2])
  })
})

describe('порядок', () => {
  it('по умолчанию — новые первыми', async () => {
    expect(await open()).toEqual([3, 2, 1])
  })

  it('сначала старые', async () => {
    expect(await open({ sort: 'oldest' })).toEqual([1, 2, 3])
  })

  it('недавно обновлённые — не то же, что новые по номеру', async () => {
    expect(await open({ sort: 'updated' })).toEqual([1, 3, 2])
  })

  it('давно не обновлялись', async () => {
    expect(await open({ sort: 'least-updated' })).toEqual([2, 3, 1])
  })

  it('больше ответов', async () => {
    expect(await open({ sort: 'most-commented' })).toEqual([3, 1, 2])
  })

  it('меньше ответов', async () => {
    expect(await open({ sort: 'least-commented' })).toEqual([2, 1, 3])
  })
})

describe('счётчики', () => {
  it('считают под действующим отбором, а не по всему списку', async () => {
    // ⚠️ Раньше считались все задачи списка: с фильтром «назначено мне» человек видел бы
    // «3 открытых» и одну строку под ними.
    const all = await getIssueCounts(templateId)
    expect(all).toEqual({ open: 3, closed: 1 })

    const mine = await getIssueCounts(templateId, { status: 'open', authorId: meId })
    expect(mine, 'у меня одна открытая и одна закрытая').toEqual({ open: 1, closed: 1 })
  })

  it('число страниц считается по тому же отбору, что и выдача', async () => {
    for (const opts of [{ authorId: meId }, { assigneeId: meId }, { q: 'говорливая' }]) {
      const query = { status: 'open' as const, ...opts }
      expect(await countListIssues(templateId, query), JSON.stringify(opts)).toBe((await open(opts)).length)
    }
  })
})
