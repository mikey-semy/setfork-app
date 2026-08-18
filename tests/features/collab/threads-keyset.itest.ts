import { beforeEach, describe, expect, it } from 'vitest'
import { decodeCursor } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ОСТАВШИЕСЯ ТРЕДЫ — обсуждения и предложения. Рецепт у них общий с тредом задачи, и
 * проверяется здесь именно ОДИНАКОВОСТЬ его применения: одна поверхность, переведённая
 * чуть иначе (спутанный порядок показа, разворот не на том шаге), выглядит рабочей, пока
 * не откроют вторую порцию.
 *
 * Поэтому обе поверхности гоняются ОДНИМ набором проверок. Расхождение между ними — само
 * по себе дефект, даже если каждая по отдельности «работает».
 */

const { db, discussionComments, discussions, suggestionComments, suggestions, templates, users } =
  await import('@/shared/db')
const { getDiscussionCommentsPage } = await import('@/features/discussions/queries')
const { getSuggestionCommentsPage, getSuggestionParticipants } = await import('@/features/library/queries')

const COUNT = 7
const PER = 3

type Page = { items: { id: string; body: string }[]; next: string | null; prev: string | null }
type Surface = { name: string; page: (per: number, cur: string | null, dir?: 'after' | 'before') => Promise<Page> }

let surfaces: Surface[] = []
let participantsOf: () => Promise<{ handle: string }[]>

beforeEach(async () => {
  await resetTables([discussionComments, discussions, suggestionComments, suggestions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'thread-a' }).returning({ id: users.id })
  const [g] = await db.insert(users).values({ handle: 'thread-b' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'threads-list', title: { ru: 'т' } })
    .returning({ id: templates.id })
  const [disc] = await db
    .insert(discussions)
    .values({ templateId: tpl.id, number: 1, title: 'о чём-то', authorId: u.id, category: 'general' })
    .returning({ id: discussions.id })
  const [sug] = await db
    .insert(suggestions)
    .values({ templateId: tpl.id, authorId: u.id, baseVersion: 1 })
    .returning({ id: suggestions.id })

  const bodies = Array.from({ length: COUNT }, (_, i) => `реплика ${i}`)
  const at = (i: number) => new Date(Date.UTC(2026, 7, 18, 12, 0, i))
  await db.insert(discussionComments).values(
    bodies.map((body, i) => ({ discussionId: disc.id, authorId: i % 2 === 0 ? u.id : g.id, body, createdAt: at(i) })),
  )
  await db.insert(suggestionComments).values(
    bodies.map((body, i) => ({ suggestionId: sug.id, authorId: i % 2 === 0 ? u.id : g.id, body, createdAt: at(i) })),
  )

  surfaces = [
    {
      name: 'обсуждение',
      page: (per, cur, dir) => getDiscussionCommentsPage(disc.id, per, decodeCursor(cur), dir) as Promise<Page>,
    },
    {
      name: 'предложение',
      page: (per, cur, dir) => getSuggestionCommentsPage(sug.id, per, decodeCursor(cur), dir) as Promise<Page>,
    },
  ]
  // Участники предложения — по всему треду, а не по показанной порции.
  participantsOf = () => getSuggestionParticipants(sug.id)
})

describe('треды обсуждения и предложения листаются ключом одинаково', () => {
  it('первая порция — НАЧАЛО треда у обеих поверхностей', async () => {
    for (const s of surfaces) {
      const p = await s.page(PER, null)
      expect(p.items.map((c) => c.body), s.name).toEqual(['реплика 0', 'реплика 1', 'реплика 2'])
      expect(p.prev, s.name).toBeNull()
    }
  })

  it('обход даёт весь тред по порядку и без повторов', async () => {
    for (const s of surfaces) {
      const seen: string[] = []
      let cur: string | null = null
      for (let i = 0; i < 10; i++) {
        const p: Page = await s.page(PER, cur)
        seen.push(...p.items.map((c) => c.body))
        if (!p.next) break
        cur = p.next
      }
      expect(seen, s.name).toEqual(Array.from({ length: COUNT }, (_, i) => `реплика ${i}`))
    }
  })

  it('шаг назад возвращает ровно ту порцию, с которой ушли', async () => {
    for (const s of surfaces) {
      const first = await s.page(PER, null)
      const second = await s.page(PER, first.next)
      const back = await s.page(PER, second.prev, 'before')
      expect(back.items.map((c) => c.id), s.name).toEqual(first.items.map((c) => c.id))
    }
  })

  it('«назад» без курсора не открывает тред с конца', async () => {
    for (const s of surfaces) {
      const start = await s.page(PER, null)
      const bogus = await s.page(PER, null, 'before')
      expect(bogus.items.map((c) => c.id), s.name).toEqual(start.items.map((c) => c.id))
    }
  })

  it('участники предложения не зависят от показанной порции', async () => {
    expect((await participantsOf()).map((p) => p.handle)).toEqual(['thread-a', 'thread-b'])
  })
})
