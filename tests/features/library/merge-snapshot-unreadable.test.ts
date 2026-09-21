import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * СБОЙ ЧТЕНИЯ ВЕТКИ НЕ ОТКРЫВАЕТ СТРАЖА ИСПОЛНЯЕМЫХ КОМАНД.
 *
 * Слияние ветки создаёт версию в самом ядре и фасад записи минует, поэтому команды
 * вроде `rm -rf /` проверяются здесь, на пути слияния, — это ЕДИНСТВЕННЫЙ исполнитель
 * правила: merge-пути ядра спрашивают только право на запись, про содержимое — лишь на
 * пуше.
 *
 * Страж брал содержимое ветки снапшотом, а чтение снапшота гасило собственный отказ и
 * отдавало пустой список. «Команд нет» и «прочитать не удалось» выглядели одинаково, и
 * второе означало РАЗРЕШЕНИЕ: обрыв связи с ядром между двумя вызовами — и правка с
 * исполняемой командой уезжала в main и в `/raw`.
 *
 * Тест держит оба конца: отказ чтения останавливает слияние (и в ядро не уходит
 * ничего), а рабочее чтение по-прежнему и пропускает чистую правку, и ловит команду.
 */
const h = vi.hoisted(() => ({
  sug: null as null | Record<string, unknown>,
  /** Чем отвечает чтение снапшота: снимок, «ветки нет» (null) или отказ связи. */
  snapshot: null as null | Record<string, unknown> | 'throw',
  merges: [] as string[],
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/shared/db', () => ({
  db: {
    query: { suggestions: { findFirst: async () => h.sug } },
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void h.updates.push(v) }) }),
    select: () => ({ from: () => ({ where: async () => [{ handle: 'owner-user' }] }) }),
  },
  suggestions: {},
  users: {},
}))
vi.mock('drizzle-orm', async (orig) => ({ ...(await orig<typeof import('drizzle-orm')>()), eq: () => ({}) }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))
vi.mock('@/features/notifications/notify', () => ({ notify: async () => {} }))
vi.mock('@/features/library/suggestion-side-effects', () => ({
  closeLinkedIssues: async () => {},
  notifyWatchersNewVersion: async () => {},
}))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: async () => {} }))
vi.mock('@/features/moderation/moderate-list', () => ({ recheckList: async () => {} }))
vi.mock('@/shared/observability', () => ({ captureError: () => {} }))
vi.mock('@/features/library/suggestion-core/gates', () => ({ reviewGates: async () => null }))
vi.mock('@/features/library/suggestion-core/revision', () => ({ currentRevision: async () => 'rev' }))
vi.mock('@/features/library/suggestion-core/apply', () => ({ applySuggestion: async () => ({ ok: false, reason: 'unused' }) }))

/**
 * Подменяем РОВНО внешнее — сам git-порт. Правило (`findDestructiveSteps`), разбор
 * снапшота в блоки и чтение с отличением отказа от пустоты остаются настоящими: подмени
 * их, и тест зеленел бы при любом их поведении.
 */
vi.mock('@/features/git/core', () => ({
  gitCore: {
    branchSnapshot: async () => {
      if (h.snapshot === 'throw') throw new Error('core unavailable')
      return h.snapshot
    },
    mergeBranch: async (_repo: unknown, name: string) => {
      h.merges.push(name)
      return { tipSha: 'c', newVersion: 7, fastForward: false }
    },
    mergeState: async () => null,
    deleteBranch: async () => {},
  },
}))

const { mergeSuggestion } = await import('@/features/library/suggestion-core/merge')
const { MERGE_ERR } = await import('@/app/[handle]/[slug]/suggestions/[id]/merge-err')

/** Снимок ветки в форме порта: один шаг с заданной командой. */
const snapshotWith = (command: string) => ({
  tipSha: 'b',
  title: 'список',
  desc: '',
  tags: [],
  ordered: false,
  steps: [
    {
      n: 1,
      blockId: 'b1',
      type: 'step',
      title: 'шаг',
      desc: '',
      why: '',
      section: '',
      level: 'normal',
      command,
      subtasks: [],
      refs: [],
      content: {},
      imageKey: '',
      needsHuman: false,
      needsHumanAsk: {},
      danger: false,
    },
  ],
})

beforeEach(() => {
  Object.assign(h, { merges: [], updates: [], snapshot: snapshotWith('') })
  h.sug = {
    id: 's1',
    status: 'open',
    branchRef: 'feature-1',
    note: 'правка',
    number: 5,
    authorId: 'author',
    templateId: 't1',
    template: { id: 't1', ownerId: 'owner', slug: 'spisok', currentVersion: 3, visibility: 'private', prSettings: {} },
  }
})

describe('страж исполняемых команд на слиянии ветки', () => {
  it('⚠️ содержимое не прочиталось — слияния не происходит, и причина названа', async () => {
    h.snapshot = 'throw'

    const res = await mergeSuggestion('s1', 'owner')

    expect(res.ok, 'на нечитаемом содержимом сливать нельзя: проверять было нечем').toBe(false)
    expect(h.merges, 'в ядро не должно уйти НИЧЕГО').toEqual([])
    expect(h.updates, 'предложение не становится принятым').toEqual([])
  })

  it('причина отказа — та, которую страница умеет сказать словами', async () => {
    h.snapshot = 'throw'

    const res = await mergeSuggestion('s1', 'owner')

    // Без строки в словаре код доехал бы до страницы и упал в общий «не удалось
    // выполнить merge» — то есть человек не узнал бы ни причины, ни что повтор поможет.
    const reason = (res as { reason: string }).reason
    expect(MERGE_ERR[reason], `код ${reason} не имеет текста для человека`).toBeTruthy()
  })

  it('чтение работает — исполняемая команда в ветке по-прежнему ловится', async () => {
    h.snapshot = snapshotWith('rm -rf /')

    const res = await mergeSuggestion('s1', 'owner')

    expect(res.ok).toBe(false)
    expect((res as { reason: string }).reason, 'отказ называет номер шага и правило').toContain('step 1')
    expect(h.merges).toEqual([])
  })

  it('чистая правка сливается — отказ не стал заодно и запретом на всё', async () => {
    const res = await mergeSuggestion('s1', 'owner')

    expect(res.ok, 'иначе «починка» была бы просто выключенной кнопкой').toBe(true)
    expect(h.merges).toEqual(['feature-1'])
  })

  it('ветки нет вовсе (ядро ответило «не нашлось») — это ответ, а не отказ чтения', async () => {
    // Разница между двумя случаями и есть предмет починки: `null` — честный ответ ядра,
    // и вести себя как обрыв связи он не должен.
    h.snapshot = null

    const res = await mergeSuggestion('s1', 'owner')

    expect(res.ok).toBe(true)
    expect(h.merges).toEqual(['feature-1'])
  })
})
