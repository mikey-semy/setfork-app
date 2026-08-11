import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ОДНО ДЕЙСТВИЕ — ОДНО ПРАВИЛО: принять чужую правку.
 *
 * Предложение бывает двух видов (из ветки и из пунктов), и вид выбирает АВТОР, а не
 * тот, кто нажимает кнопку. Значит право не смеет от вида зависеть. До 11.08 зависело:
 * `mergeSuggestion` пускал владельца ИЛИ соавтора, а `applySuggestion` — только
 * владельца, и соавтор получал «not your list» на списке, в котором он соавтор.
 *
 * Так это устроено у других: у GitHub collaborator умеет и «merge pull requests», и
 * «apply suggested changes»; у Gitea `IsUserAllowedToMerge` спрашивает
 * `CanWrite(unit.TypeCode)` и вида предложения не различает.
 *
 * Тест держит ПАРИТЕТ, а не отдельные ответы: он падает и если сузить один вход, и
 * если расширить другой.
 *
 * ЧТО ИМЕННО ПОКРЫТО. Оба входа принятия — `mergeSuggestion` и `applySuggestion` —
 * на предложении из ПУНКТОВ; для него первый делегирует во второй, и ровно поэтому
 * расхождение было незаметным: кнопка одна, а правило за ней зависело от вида
 * правки. Ветка сюда не заводится намеренно: её фикстура требует живого репозитория
 * и ядра, а проверяемое правило (`isCollaborator` в `merge.ts`) от вида не зависит и
 * общее с этим.
 */
const { collaborators, db, templates, users } = await import('@/shared/db')
const { applySuggestion, createSuggestion, mergeSuggestion } = await import('@/features/library/suggestion-core')
const { emptyBlock, toProposedItems } = await import('@/features/library/editor')

let ownerId = ''
let collabId = ''
let strangerId = ''
let templateId = ''
let seq = 0

const items = () => toProposedItems([{ ...emptyBlock('step'), title: 'Шаг' }], 'en')

async function newSuggestion(): Promise<string> {
  const [author] = await db.insert(users).values({ handle: `parity-author-${++seq}` }).returning({ id: users.id })
  const created = await createSuggestion(author.id, templateId, { note: 'правка', items: items() })
  if (!created.ok) throw new Error(created.reason)
  return created.id
}

beforeAll(async () => {
  await resetTables([templates, users])
  const [owner] = await db.insert(users).values({ handle: 'parity-owner' }).returning({ id: users.id })
  const [collab] = await db.insert(users).values({ handle: 'parity-collab' }).returning({ id: users.id })
  const [stranger] = await db.insert(users).values({ handle: 'parity-stranger' }).returning({ id: users.id })
  ownerId = owner.id
  collabId = collab.id
  strangerId = stranger.id
})

beforeEach(async () => {
  await resetTables([templates])
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'parity-list', title: { en: 'Parity list' }, visibility: 'public', status: 'published' })
    .returning({ id: templates.id })
  templateId = tpl.id
  await db.insert(collaborators).values({ templateId, userId: collabId })
})

describe('соавтор принимает правку так же, как владелец', () => {
  it('mergeSuggestion пускает соавтора', async () => {
    const res = await mergeSuggestion(await newSuggestion(), collabId)
    expect(res.ok).toBe(true)
  })

  it('applySuggestion пускает соавтора — то же право, что у слияния', async () => {
    const res = await applySuggestion(await newSuggestion(), collabId)
    expect(res.ok).toBe(true)
  })
})

describe('посторонний не проходит НИ ОДНИМ путём', () => {
  it('mergeSuggestion отказывает', async () => {
    const res = await mergeSuggestion(await newSuggestion(), strangerId)
    expect(res).toEqual({ ok: false, reason: 'not a maintainer' })
  })

  it('applySuggestion отказывает — ТОЙ ЖЕ причиной', async () => {
    const res = await applySuggestion(await newSuggestion(), strangerId)
    expect(res).toEqual({ ok: false, reason: 'not a maintainer' })
  })
})

describe('паритет как таковой', () => {
  it('оба пути отвечают одинаково каждому из троих', async () => {
    const verdicts: Record<string, [boolean, boolean]> = {}
    for (const [who, actor] of [
      ['владелец', () => ownerId],
      ['соавтор', () => collabId],
      ['посторонний', () => strangerId],
    ] as const) {
      const merged = await mergeSuggestion(await newSuggestion(), actor())
      const applied = await applySuggestion(await newSuggestion(), actor())
      verdicts[who] = [merged.ok, applied.ok]
    }
    // Разошлись пути — значит правило снова живёт в двух местах.
    for (const [who, [merged, applied]] of Object.entries(verdicts)) {
      expect(merged, `${who}: слияние ${merged}, принятие ${applied}`).toBe(applied)
    }
    expect(verdicts).toEqual({ владелец: [true, true], соавтор: [true, true], посторонний: [false, false] })
  })
})
