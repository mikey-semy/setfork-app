import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodeCursor } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ТРЕД ЛИСТАЕТСЯ КЛЮЧОМ — и порядок показа у него ОБРАТНЫЙ ленте.
 *
 * Тред читают с начала и дописывают в конец, поэтому `asc`, и «дальше» значит «в будущее».
 * Спутать это с лентой легко, а стоит дорого: с порядком ленты «дальше» открывало бы тред
 * с последней реплики.
 *
 * Почему вообще ключом, если вставка идёт в ХВОСТ и смещение от неё не едет: едет от
 * УДАЛЕНИЯ. Снятая модерацией или убранная автором реплика сдвигает всё, что ниже, на
 * строку вверх, и следующая порция по смещению начинается не с той строки — ровно одна
 * пропадает. Это и проверяется парой «дефект реален» / «keyset его не даёт».
 */

const { db, issueComments, issues, templates, users } = await import('@/shared/db')
const { getIssueCommentsPage, getIssueParticipants } = await import('@/features/issues/queries')

const COUNT = 9
const PER = 3
let issueId = ''

const seed = async (): Promise<void> => {
  await resetTables([issueComments, issues, templates, users])
  const [u] = await db.insert(users).values({ handle: 'thread-author' }).returning({ id: users.id })
  const [other] = await db.insert(users).values({ handle: 'thread-guest' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'thread-list', title: { ru: 'т' } })
    .returning({ id: templates.id })
  const [iss] = await db
    .insert(issues)
    .values({ templateId: tpl.id, number: 1, title: 'вопрос', authorId: u.id })
    .returning({ id: issues.id })
  issueId = iss.id
  await db.insert(issueComments).values(
    Array.from({ length: COUNT }, (_, i) => ({
      issueId,
      // Автор чередуется: участников треда двое, сколько бы порций ни было.
      authorId: i % 2 === 0 ? u.id : other.id,
      body: `реплика ${i}`,
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, i)),
    })),
  )
}

const ids = async (): Promise<string[]> =>
  (
    await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId))
      .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
  ).map((r) => r.id)

beforeEach(seed)

describe('тред задачи листается ключом', () => {
  it('первая порция — НАЧАЛО треда, а не конец', async () => {
    // Порядок показа обратный ленте; спутанное направление открыло бы тред с последней
    // реплики, и это выглядело бы правдоподобно.
    const page = await getIssueCommentsPage(issueId, PER)
    expect(page.items.map((c) => c.body)).toEqual(['реплика 0', 'реплика 1', 'реплика 2'])
    expect(page.prev).toBeNull()
  })

  it('обход порциями даёт весь тред по порядку и без повторов', async () => {
    const seen: string[] = []
    let cursor = null as ReturnType<typeof decodeCursor>
    for (let i = 0; i < 10; i++) {
      const page = await getIssueCommentsPage(issueId, PER, cursor)
      seen.push(...page.items.map((c) => c.id))
      if (!page.next) break
      cursor = decodeCursor(page.next)
    }
    expect(seen).toEqual(await ids())
  })

  it('шаг назад возвращает ровно ту порцию, с которой ушли', async () => {
    const first = await getIssueCommentsPage(issueId, PER)
    const second = await getIssueCommentsPage(issueId, PER, decodeCursor(first.next))
    const back = await getIssueCommentsPage(issueId, PER, decodeCursor(second.prev), 'before')
    expect(back.items.map((c) => c.id)).toEqual(first.items.map((c) => c.id))
  })

  it('«назад» без курсора не открывает тред с конца', async () => {
    const start = await getIssueCommentsPage(issueId, PER)
    const bogus = await getIssueCommentsPage(issueId, PER, null, 'before')
    expect(bogus.items.map((c) => c.id)).toEqual(start.items.map((c) => c.id))
  })

  it('ДЕФЕКТ РЕАЛЕН: смещение теряет реплику, когда одну из показанных удалили', async () => {
    const all = await ids()
    const byOffset = async (offset: number): Promise<string[]> =>
      (
        await db
          .select({ id: issueComments.id })
          .from(issueComments)
          .where(eq(issueComments.issueId, issueId))
          .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
          .limit(PER)
          .offset(offset)
      ).map((r) => r.id)

    const first = await byOffset(0)
    await db.delete(issueComments).where(eq(issueComments.id, first[0])) // реплику убрали
    const second = await byOffset(PER)
    // Строка, шедшая четвёртой, поднялась на третью позицию — и вторая страница её
    // перепрыгнула. В итоге читатель не увидит её никогда.
    expect(second).not.toContain(all[PER])
  })

  it('KEYSET ЭТОГО НЕ ДАЁТ: удаление показанной реплики не роняет следующую', async () => {
    const all = await ids()
    const first = await getIssueCommentsPage(issueId, PER)
    await db.delete(issueComments).where(eq(issueComments.id, first.items[0].id))
    const second = await getIssueCommentsPage(issueId, PER, decodeCursor(first.next))
    // Курсор указывает на ПОСЛЕДНЮЮ показанную реплику, и удаление выше его не сдвигает.
    expect(second.items.map((c) => c.id)).toEqual(all.slice(PER, PER * 2))
  })

  it('участники треда не зависят от показанной порции', async () => {
    const people = await getIssueParticipants(issueId)
    // Оба автора чередовались по всему треду, а показывается только первая порция.
    expect(people.map((p) => p.handle).sort()).toEqual(['thread-author', 'thread-guest'])
  })
})
