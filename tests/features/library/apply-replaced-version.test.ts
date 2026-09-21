import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * КАКУЮ ВЕРСИЮ ЗАМЕНИЛА ПРИНЯТАЯ ПРАВКА — число берётся ИЗ ЗАПИСАННОГО.
 *
 * Принятие «из пунктов» подменяет состав списка целиком, и наружу едут два числа: от
 * какой версии правка собрана и какую она заменила. По их разнице и решает принимающий —
 * из них же собирается предупреждение агенту.
 *
 * Брать «заменённую» из прочитанного нельзя: список читается в начале функции, до прав,
 * до ворот ревью и до самого вызова ядра. Соавтор успевает опубликовать своё, и тогда
 * правка от v7 заменяет уже v8, а наружу уезжает «заменили 7» — предупреждение не
 * показывается (7 < 7 ложно) ровно там, где чужая версия только что выпала из текущего
 * содержимого. Тот же класс, ради которого делался весь этот PR: число из прочитанного,
 * а не из записанного.
 *
 * Ядро считает номер новой версии как `current + 1` внутри транзакции, где строка списка
 * уже взята `for update` (`setfork-core/src/git/version.rs`), — значит предыдущая версия
 * известна из ответа атомарно с самой записью.
 */

const h = vi.hoisted(() => ({
  sug: null as null | Record<string, unknown>,
  writtenVersion: 8,
}))

vi.mock('@/shared/db', () => ({
  db: {
    query: { suggestions: { findFirst: async () => h.sug } },
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
  suggestions: { id: {} },
  templates: {},
  users: {},
  steps: {},
}))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))
vi.mock('@/features/notifications/notify', () => ({ notify: vi.fn() }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: vi.fn() }))
vi.mock('@/features/library/suggestion-side-effects', () => ({
  closeLinkedIssues: vi.fn(),
  notifyWatchersNewVersion: vi.fn(),
}))
// Ворота ревью и ревизия ходят в базу и к предмету теста отношения не имеют: здесь
// проверяется ОДНО число, а не правила допуска.
vi.mock('@/features/library/suggestion-core/gates', () => ({ reviewGates: async () => null }))
vi.mock('@/features/library/suggestion-core/revision', () => ({ currentRevision: async () => 'rev' }))
vi.mock('@/features/library/list-store', () => ({
  listStore: { addVersion: vi.fn(async () => ({ version: h.writtenVersion })) },
}))

const { applySuggestion } = await import('@/features/library/suggestion-core/apply')

/** Предложение от базы `base` на списке, который НА МОМЕНТ ЧТЕНИЯ был на `read`. */
const pending = (base: number, read: number) => ({
  id: 's1',
  status: 'open',
  baseVersion: base,
  items: [{ type: 'step', title: { ru: 'шаг' } }],
  note: 'правка',
  authorId: 'guest',
  templateId: 't1',
  template: { id: 't1', ownerId: 'owner', slug: 'spisok', currentVersion: read, prSettings: null },
})

beforeEach(() => {
  h.writtenVersion = 8
})

describe('принятая правка называет заменённую версию', () => {
  it('без гонки: прочитали 7, записали 8 — заменена 7', async () => {
    h.sug = pending(7, 7)
    h.writtenVersion = 8

    const res = await applySuggestion('s1', 'owner')

    expect(res).toMatchObject({ ok: true, version: 8, baseVersion: 7, replacedVersion: 7 })
  })

  it('соавтор опубликовал v8, пока шли проверки: заменена 8, а не прочитанная 7', async () => {
    // Список прочитан на 7, ядро отдало 9 — значит под замком строки была именно 8.
    h.sug = pending(7, 7)
    h.writtenVersion = 9

    const res = await applySuggestion('s1', 'owner')

    expect(res).toMatchObject({ ok: true, version: 9, replacedVersion: 8 })
    // Главное следствие: база ОТСТАЛА, и это видно по числам — предупреждение соберётся.
    const r = res as { baseVersion: number; replacedVersion: number }
    expect(r.baseVersion < r.replacedVersion, 'чужая версия выпала молча, а ответ это скрыл').toBe(true)
  })

  it('правка от свежей базы гонку не выдумывает', async () => {
    h.sug = pending(8, 8)
    h.writtenVersion = 9

    const res = await applySuggestion('s1', 'owner')
    const r = res as { baseVersion: number; replacedVersion: number }
    expect(r.baseVersion < r.replacedVersion).toBe(false)
  })
})
