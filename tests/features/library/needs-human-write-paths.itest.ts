import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Пометка «здесь нужен человек» на ПУТЯХ ЗАПИСИ ВЕРСИИ из features/library/actions.ts.
//
// Там жила локальная копия toStepInput, знавшая про blockId, но не знавшая про
// needsHuman/needsHumanAsk (общая копия в shared/lib/step-input.ts — ровно наоборот).
// Из-за этого принятие правки и откат версии молча стирали пометку: набор шагов
// перезаписывается ЦЕЛИКОМ, поэтому поле, о котором путь не знает, ИСЧЕЗАЕТ (рунбук
// list-field-paths.md, инцидент R1 — здесь он повторился на другом пути).
//
// Тест против реальной БД: и пометка, и идентичность блока должны пережить оба пути.

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/features/notifications/notify', () => ({ notify: async () => {}, notifyMany: async () => {}, notifyMentions: async () => {} }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: async () => {}, enqueueLinkCheck: async () => {} }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/media', () => ({ avatarSrc: async () => null, imageUrl: () => null, isS3Configured: () => false }))

const { db, steps, suggestions, templateVersions, templates, users } = await import('@/shared/db')
import type { ProposedItem } from '@/shared/db'
import { resetTables } from '../../helpers/reset-db'
const { revertToVersion } = await import('@/features/library/actions')
// applySuggestion живёт вне экшен-файла намеренно: её личность действующего лица
// приходит аргументом, и сетевой точкой входа она быть не должна.
const { applySuggestion } = await import('@/features/library/suggestion-core')

let ownerId = ''
let authorId = ''
let tplId = ''
const BID = '00000000-0000-0000-0000-0000000000b1'

const markedItem: ProposedItem = {
  blockId: BID,
  type: 'step',
  title: { ru: 'купить муку' },
  desc: {},
  command: '',
  hasImage: false,
  level: 'required',
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  needsHuman: true,
  needsHumanAsk: { ru: 'сколько стоит у вас?' },
}

beforeEach(async () => {
  await resetTables([suggestions, steps, templateVersions, templates, users])
  const [o] = await db.insert(users).values({ handle: 'nh-owner' }).returning({ id: users.id })
  const [a] = await db.insert(users).values({ handle: 'nh-author' }).returning({ id: users.id })
  ownerId = o.id
  authorId = a.id
  const [t] = await db.insert(templates).values({ ownerId, slug: 'nh-list', title: { ru: 'Список' } }).returning({ id: templates.id })
  tplId = t.id
  const [v] = await db.insert(templateVersions).values({ templateId: tplId, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  // Версия 1 УЖЕ содержит пометку — как её пишет генерация.
  await db.insert(steps).values({
    versionId: v.id,
    n: 1,
    type: 'step',
    blockId: BID,
    title: { ru: 'купить муку' },
    needsHuman: true,
    needsHumanAsk: { ru: 'сколько стоит у вас?' },
  })
  h.session = { userId: ownerId, handle: 'nh-owner' }
})
afterAll(async () => {
  await resetTables([suggestions, steps, templateVersions, templates, users])
})

const stepsOfVersion = async (version: number) => {
  const [v] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(sql`template_id = ${tplId} and version = ${version}`)
  return db.select({ blockId: steps.blockId, needsHuman: steps.needsHuman, ask: steps.needsHumanAsk }).from(steps).where(sql`version_id = ${v.id}`)
}

describe('пометка «здесь нужен человек» на путях записи версии', () => {
  it('ПРИНЯТИЕ ПРАВКИ сохраняет пометку и вопрос', async () => {
    const [s] = await db
      .insert(suggestions)
      .values({ templateId: tplId, authorId, number: 1, baseVersion: 1, note: 'правка', items: [markedItem] })
      .returning({ id: suggestions.id })

    const res = await applySuggestion(s.id, ownerId)
    expect(res).toMatchObject({ ok: true, version: 2 })

    const after = await stepsOfVersion(2)
    expect(after).toHaveLength(1)
    expect(after[0].blockId).toBe(BID) // идентичность блока переносится
    expect(after[0].needsHuman).toBe(true) // ← вот это и проверяем
    expect(after[0].ask).toEqual({ ru: 'сколько стоит у вас?' })
  })

  it('ОТКАТ К ВЕРСИИ с пометкой возвращает её вместе с содержимым', async () => {
    // v2 без пометки (человек ответил), затем откат к v1 — пометка должна вернуться.
    const [v2] = await db.insert(templateVersions).values({ templateId: tplId, version: 2, note: 'v2' }).returning({ id: templateVersions.id })
    await db.insert(steps).values({ versionId: v2.id, n: 1, type: 'step', blockId: BID, title: { ru: 'купить муку — 200 ₽' } })
    await db.update(templates).set({ currentVersion: 2 }).where(sql`id = ${tplId}`)

    await revertToVersion(tplId, 1).catch((e) => {
      if (!(e as Error).message.startsWith('REDIRECT')) throw e
    })

    const after = await stepsOfVersion(3)
    expect(after).toHaveLength(1)
    expect(after[0].needsHuman).toBe(true)
    expect(after[0].ask).toEqual({ ru: 'сколько стоит у вас?' })
  })
})
