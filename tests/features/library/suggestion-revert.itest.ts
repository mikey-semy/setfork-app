import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Откат принятого предложения на реальной БД.
 *
 * Чистая логика обратной правки проверена отдельно (suggestion-revert.test.ts).
 * Здесь — то, что видно только на живых данных: откат создаёт НОВОЕ предложение и
 * проходит те же ворота, отменяет ВКЛАД (а не возвращает список к снимку), и
 * отказывается трогать пункты, которые после слияния правил кто-то ещё.
 */
const { db, suggestions, templates, users } = await import('@/shared/db')
const { createSuggestion, mergeSuggestion, revertSuggestion } = await import('@/features/library/suggestion-core')
const { getVersionSteps } = await import('@/features/library/queries')
const { emptyBlock, toProposedItems } = await import('@/features/library/editor')

let ownerId = ''
let templateId = ''
let authorSeq = 0

// Пункты собираем ТЕМ ЖЕ путём, что продукт (редактор и MCP): там пунктам
// проставляется blockId, а откат работает по идентичности блоков.
const step = (title: string) => ({ ...emptyBlock('step'), title })

/**
 * Состояние списка между правками. Ключевое: идентичность блоков ПЕРЕЖИВАЕТ версии —
 * редактор открывается на существующих пунктах и сохраняет их blockId. Тест, который
 * каждый раз выдумывает новые id, проверял бы несуществующий сценарий.
 */
let state: ReturnType<typeof toProposedItems> = []
const build = (items: ReturnType<typeof step>[]) => toProposedItems(items, 'en')
// Идентичность в редакторе живёт в поле `bid` (его и читает toProposedItems).
// Положить её в `blockId` — значит получить каждый раз новые id, то есть список,
// который «переписали целиком»; ровно так тест и врал сначала.
const editorFromState = () =>
  state.map((b) => ({
    ...emptyBlock('step'),
    bid: (b as unknown as { blockId?: string }).blockId ?? '',
    title: String((b as unknown as { title?: { en?: string } }).title?.en ?? ''),
  }))
const titles = async (): Promise<string[]> => {
  const [tpl] = await db.select({ v: templates.currentVersion }).from(templates).where(eq(templates.id, templateId))
  const snap = await getVersionSteps(templateId, tpl.v)
  return (snap?.steps ?? []).map((s: unknown) => String((s as { title?: { en?: string; ru?: string } }).title?.en ?? (s as { title?: string }).title ?? ''))
}

/** Новый автор на каждую правку: кап «10 за 10 минут» — настоящий гейт. */
async function newAuthor(): Promise<string> {
  const [u] = await db.insert(users).values({ handle: `rev-author-${++authorSeq}` }).returning({ id: users.id })
  return u.id
}

/** Предложить и сразу слить — так получается «принятый вклад», который можно откатывать. */
async function mergeEdit(next: ReturnType<typeof toProposedItems>): Promise<string> {
  const authorId = await newAuthor()
  const created = await createSuggestion(authorId, templateId, { note: 'правка', items: next })
  if (!created.ok) throw new Error(`не создалось: ${created.reason}`)
  const merged = await mergeSuggestion(created.id, ownerId)
  if (!merged.ok) throw new Error(`не слилось: ${merged.reason}`)
  state = next
  return created.id
}

/** Первая версия списка. */
const seed = (...titles: string[]) => mergeEdit(build(titles.map(step)))
/** Добавить пункт в конец — у него будет НОВЫЙ blockId, у остальных прежние. */
const addItem = (title: string) => mergeEdit(build([...editorFromState(), step(title)]))
/** Переписать существующий пункт — blockId сохраняется. */
const editItem = (i: number, title: string) =>
  mergeEdit(build(editorFromState().map((b, k) => (k === i ? { ...b, title } : b))))

beforeAll(async () => {
  await resetTables([templates, users])
  const [owner] = await db.insert(users).values({ handle: 'rev-owner' }).returning({ id: users.id })
  ownerId = owner.id
})

beforeEach(async () => {
  await resetTables([templates])
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'rev-list', title: { en: 'Revert list' }, visibility: 'public', status: 'published' })
    .returning({ id: templates.id })
  templateId = tpl.id
  state = []
})

describe('откат создаёт предложение, а не правит историю', () => {
  it('открывается новое ОТКРЫТОЕ предложение со ссылкой на отменяемое', async () => {
    await seed('Первый')
    const first = await addItem('Второй')
    const res = await revertSuggestion(ownerId, first)
    expect(res).toMatchObject({ ok: true })

    const rows = await db.select({ id: suggestions.id, status: suggestions.status, revertOf: suggestions.revertOfId, note: suggestions.note }).from(suggestions)
    const revert = rows.find((r) => r.revertOf === first)!
    expect(revert.status).toBe('open') // не применилось само — ждёт ревью и слияния
    expect(revert.note).toContain('Revert')
    // Список пока НЕ изменился: откат — это предложение, а не действие.
    expect(await titles()).toEqual(['Первый', 'Второй'])
  })

  it('после слияния отката вклад действительно отменён', async () => {
    await seed('Первый')
    const second = await addItem('Второй') // вклад: добавлен «Второй»
    const res = await revertSuggestion(ownerId, second)
    expect(res).toMatchObject({ ok: true })
    const [revertRow] = await db.select({ id: suggestions.id }).from(suggestions).where(eq(suggestions.revertOfId, second))
    expect(await mergeSuggestion(revertRow.id, ownerId)).toMatchObject({ ok: true })
    expect(await titles()).toEqual(['Первый'])
  })
})

describe('кто и что может откатывать', () => {
  it('посторонний не откатывает чужое', async () => {
    const first = await seed('Первый')
    const strangerId = await newAuthor()
    expect(await revertSuggestion(strangerId, first)).toMatchObject({ reason: 'not a maintainer' })
  })

  it('открытое предложение откатывать нечего', async () => {
    const authorId = await newAuthor()
    const created = await createSuggestion(authorId, templateId, { note: 'ещё не принято', items: build([step('X')]) })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(await revertSuggestion(ownerId, created.id)).toMatchObject({ reason: expect.stringContaining('accepted') })
  })

  it('повторный откат не плодит второе отменяющее предложение', async () => {
    await seed('Первый')
    const first = await addItem('Второй')
    await revertSuggestion(ownerId, first)
    expect(await revertSuggestion(ownerId, first)).toMatchObject({ reason: expect.stringContaining('already being reverted') })
  })

  it('принятое до появления отката (без версии слияния) — честный отказ, а не догадка', async () => {
    const first = await seed('Первый')
    await db.update(suggestions).set({ mergedVersion: null }).where(eq(suggestions.id, first))
    expect(await revertSuggestion(ownerId, first)).toMatchObject({ reason: expect.stringContaining('by hand') })
  })
})

describe('чужая работа поверх', () => {
  it('пункт, изменённый после слияния, откат не затирает — называет его', async () => {
    await seed('Первый')
    const second = await addItem('Второй')
    // Кто-то переписал добавленный пункт уже после слияния.
    await editItem(1, 'Второй, переписанный')
    const res = await revertSuggestion(ownerId, second)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.conflicts?.map((c) => c.title)).toEqual(['Второй, переписанный'])
  })

  it('чужие пункты, которых правка не касалась, откат не трогает', async () => {
    await seed('Первый')
    const second = await addItem('Второй')
    await addItem('Третий чужой')
    expect(await revertSuggestion(ownerId, second)).toMatchObject({ ok: true })
    const [revertRow] = await db.select({ id: suggestions.id }).from(suggestions).where(eq(suggestions.revertOfId, second))
    await mergeSuggestion(revertRow.id, ownerId)
    expect(await titles()).toEqual(['Первый', 'Третий чужой'])
  })
})
