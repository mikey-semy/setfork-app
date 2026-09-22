import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ГОНКА С ВЛАДЕЛЬЦЕМ — ОТДЕЛЬНЫЙ ИСХОД РОСТА ЛЕНТЫ, а не разновидность «не получилось».
 *
 * Живой список растёт так: проход читает состав, ходит в модель, пишет версию. Между
 * чтением и записью владелец успевает опубликовать своё — тогда писать нельзя, его версия
 * исчезла бы из текущей. Это НОРМА: проход по расписанию повторится и возьмёт свежий
 * состав.
 *
 * Отдавать наружу `failed` (как при отказе модели) нельзя: смотрящему в журнал эти два
 * случая нужны для разного — гонка повторится сама, поломка требует человека. Под одним
 * значением их не различить.
 *
 * И материал потока при отказе НЕ СПИСЫВАЕТСЯ: `markUsed` стоит после записи ровно затем,
 * чтобы новость не пропала навсегда вместе с версией, которой не случилось.
 */

const h = vi.hoisted(() => ({
  // Чем отвечает порт записи: null — обычной версией, ошибка — отказом ядра.
  refuseWith: null as null | Error,
  marked: [] as string[][],
}))

vi.mock('@/shared/db', () => ({ db: {}, suggestions: {} }))
vi.mock('@/features/notifications/notify', () => ({ notify: vi.fn(), notifyMany: vi.fn() }))
vi.mock('@/features/watch/queries', () => ({ getWatcherIds: vi.fn(async () => []) }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: vi.fn() }))
vi.mock('@/shared/agents/policy', () => ({ recordAgentAction: vi.fn() }))
vi.mock('@/shared/observability', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/ai/feed-pick', () => ({
  freshForDomains: vi.fn(async () => [{ id: 'f1', url: 'https://a.example/v2', title: 'Вышел релиз v2', hint: '', publishedAt: new Date('2026-09-01') }]),
  markUsed: vi.fn(async (ids: string[]) => {
    h.marked.push(ids)
  }),
}))
vi.mock('@/shared/ai/generate', () => ({
  generateListRefine: vi.fn(async () => ({
    title: 'Лента',
    desc: 'Что нового',
    tags: ['devops'],
    items: [
      { title: 'Новое: перейти на v2', desc: '2026-09-01 что сделать', command: '', level: 'required', why: '', subtasks: [], refs: [{ label: 'a.example', url: 'https://a.example/v2' }] },
      { title: 'Старый пункт', desc: 'что делать', command: '', level: 'required', why: '', subtasks: [], refs: [] },
    ],
  })),
}))
// Ядро записи подменено НЕ ЦЕЛИКОМ: `publishGardenerVersion` — свой код и работает
// по-настоящему, отказ приходит оттуда, откуда он приходит в проде — из порта записи.
vi.mock('@/features/library/list-store', () => ({
  listStore: {
    addVersion: vi.fn(async () => {
      if (h.refuseWith) throw h.refuseWith
      return { version: 7 }
    }),
  },
}))

const { ListWriteError } = await import('@/core')
const { growLiving } = await import('@/features/gardener/sweep/living')

const tpl = { id: 't1', slug: 'devops-feed', tags: ['devops'] }
const current = {
  title: 'Лента',
  desc: 'Что нового',
  tags: ['devops'],
  items: [{ title: 'Старый пункт', desc: 'что делать', command: '', level: 'required' as const, why: '', subtasks: [], refs: [] }],
}
const ctx = { tenderId: 'u1', agentId: 'a1', policyVersion: 1, mode: 'version' as const, ownerId: 'u1', baseVersion: 5 }

beforeEach(() => {
  h.refuseWith = null
  h.marked = []
})

describe('рост живого списка: список ушёл вперёд', () => {
  it('исход назван своим именем, а не «не получилось»', async () => {
    h.refuseWith = new ListWriteError('stale')
    const res = await growLiving(tpl, current, 'ru', 'procedure', ctx)
    expect(res.result, 'гонку от поломки модели в журнале не отличить').toBe('stale')
  })

  it('материал потока НЕ списан — повод достанется следующему проходу', async () => {
    h.refuseWith = new ListWriteError('stale')
    await growLiving(tpl, current, 'ru', 'procedure', ctx)
    expect(h.marked, 'списанная без версии новость пропала бы навсегда').toEqual([])
  })

  it('когда запись проходит — исход прежний и материал списан', async () => {
    const res = await growLiving(tpl, current, 'ru', 'procedure', ctx)
    expect(res.result).toBe('grown')
    expect(h.marked).toEqual([['f1']])
  })

  it('база, из которой прочитан состав, уезжает в ядро', async () => {
    const { listStore } = await import('@/features/library/list-store')
    await growLiving(tpl, current, 'ru', 'procedure', ctx)
    expect(vi.mocked(listStore.addVersion).mock.calls.at(-1)?.[1]).toMatchObject({ expectedVersion: 5 })
  })
})
