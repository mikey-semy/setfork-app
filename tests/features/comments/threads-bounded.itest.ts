import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Реплики тредов грузятся ТОЛЬКО для запрошенного предложения.
 *
 * Условия не было вовсе: страница одного предложения читала все комментарии базы и
 * подписывала аватар каждому автору — по сетевому вызову на строку. С ростом базы
 * это разрастающаяся задержка на самой посещаемой странице; заодно в память
 * поднимались чужие реплики, которым там делать нечего.
 *
 * Проверяем на живой БД: у соседнего предложения свои треды и реплики, и они не
 * должны попадать в ответ.
 */
// Считаем ПОДПИСИ АВАТАРОВ: именно они делают лишние строки дорогими — по сетевой
// подписи URL на каждую. По одному лишь ответу дефект не виден: чужие реплики
// отсеиваются при группировке по тредам, то есть тихо стоят денег и памяти.
const avatarCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('@/shared/media', () => ({
  avatarSrc: async (v: string | null) => {
    avatarCalls.n++
    return v
  },
}))

const { blockComments, blockCommentThreads, db, suggestions, templates, users } = await import('@/shared/db')
const { getSuggestionThreads } = await import('@/features/comments/queries')

let authorId = ''
let mineId = ''
let otherId = ''

async function threadWithComment(suggestionId: string, body: string) {
  const [t] = await db
    .insert(blockCommentThreads)
    .values({
      suggestionId,
      blockId: '11111111-1111-1111-1111-111111111111',
      field: 'title',
      createdVersion: 1,
      anchorOriginal: { quote: 'цитата' },
      contextSnapshot: 'цитата',
    })
    .returning({ id: blockCommentThreads.id })
  await db.insert(blockComments).values({ threadId: t.id, authorId, body })
  return t.id
}

beforeEach(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'cm-author' }).returning({ id: users.id })
  authorId = u.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: authorId, slug: 'cm-list', title: { en: 'L' } })
    .returning({ id: templates.id })
  const rows = await db
    .insert(suggestions)
    .values([
      { templateId: tpl.id, authorId, note: 'моё', baseVersion: 1, items: [], number: 1 },
      { templateId: tpl.id, authorId, note: 'соседнее', baseVersion: 1, items: [], number: 2 },
    ])
    .returning({ id: suggestions.id })
  mineId = rows[0].id
  otherId = rows[1].id
})

describe('границы загрузки реплик', () => {
  it('чужие реплики не читаются вовсе, а не отсеиваются потом', async () => {
    await threadWithComment(mineId, 'моя реплика')
    await threadWithComment(otherId, 'реплика соседнего предложения')

    avatarCalls.n = 0
    const threads = await getSuggestionThreads(mineId, authorId)
    const bodies = threads.flatMap((t) => t.comments.map((c) => c.body))
    expect(bodies).toEqual(['моя реплика'])
    // Ровно одна подпись аватара — на единственную нужную реплику. Раньше читались
    // ВСЕ комментарии базы, и подпись делалась каждой строке: на живой базе это
    // растущая задержка самой посещаемой страницы.
    expect(avatarCalls.n, 'подписан аватар для чужой реплики — значит она была прочитана').toBe(1)
  })

  it('без тредов ответ пустой и лишнего не читается', async () => {
    await threadWithComment(otherId, 'реплика соседнего предложения')
    expect(await getSuggestionThreads(mineId, authorId)).toEqual([])
  })
})
