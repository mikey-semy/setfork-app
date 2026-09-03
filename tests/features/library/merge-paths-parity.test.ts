import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ДВА ПУТИ СЛИЯНИЯ ДЕЛАЮТ ОДНО И ТО ЖЕ.
 *
 * Слить ветку можно двумя способами: обычным (`mergeSuggestion`) и через ручное
 * разрешение конфликтов (`resolveBranchPr`). Второй писался отдельно от первого, тестов
 * не имел вовсе — и молча разошёлся с ним в трёх местах:
 *
 *  1. не писал `mergedVersion` — откат потом отказывал («no version recorded»), то есть
 *     правку, которую пришлось сливать вручную (самую рискованную), вернуть было нельзя;
 *  2. не проверял исполняемые команды — а обе ветви пишут версию В ЯДРЕ, минуя фасадный
 *     страж. Дыра открывалась так: положить команду в ветку, СОЗДАТЬ конфликт, и владелец,
 *     разрешая его, вливает её в main мимо проверки;
 *  3. не удалял ветку при `autoDeleteBranch` — настройка работала у одного пути из двух.
 *
 * Тест держит именно ПАРИТЕТ, а не отдельные свойства: расхождение между двумя ветвями
 * одного действия — это класс, и ловить его надо целиком.
 */
const h = vi.hoisted(() => ({
  sug: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  merged: null as null | Record<string, unknown>,
  deletedBranches: [] as string[],
  redirects: [] as string[],
  newVersion: 7 as number | null,
  prSettings: {} as Record<string, unknown>,
}))

vi.mock('@/shared/db', () => ({
  db: {
    query: { suggestions: { findFirst: async () => h.sug } },
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void h.updates.push(v) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ handle: 'owner-user' }] }) }) }),
  },
  suggestions: {},
  users: {},
}))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: 'owner', handle: 'owner-user' }) }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => false }))
vi.mock('@/features/notifications/notify', () => ({ notify: async () => {} }))
vi.mock('../../../src/features/library/suggestion-side-effects', () => ({
  closeLinkedIssues: async () => {},
  notifyWatchersNewVersion: async () => {},
}))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: async () => {} }))
vi.mock('@/features/moderation/moderate-list', () => ({ recheckList: async () => {} }))
vi.mock('@/shared/observability', () => ({ captureError: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    h.redirects.push(to)
    throw Object.assign(new Error(`REDIRECT ${to}`), { redirectTo: to })
  },
}))

type TwStep = { id: string; title: string; desc: string; why: string; command: string; links: unknown[] }
type Side = { title: string; desc: string; tags: string[]; ordered: boolean; steps: TwStep[]; tipSha: string }
const side = (steps: TwStep[] = []): Side => ({ title: 'с', desc: '', tags: [], ordered: false, steps, tipSha: 'a' })

/** Ядро подменено: нам нужно, что ему передали и что записали после ответа. */
const gitCore = {
  mergeState: async (): Promise<{ base: Omit<Side, 'tipSha'>; ours: Side; theirs: Side; mergeBaseSha: string }> => ({
    base: side(),
    ours: side(),
    theirs: { ...side(), tipSha: 'b' },
    mergeBaseSha: 'a',
  }),
  mergeResolved: async (_repo: unknown, _branch: string, content: Record<string, unknown>) => {
    h.merged = content
    return { tipSha: 'c', newVersion: h.newVersion, fastForward: false }
  },
  deleteBranch: async (_repo: unknown, branch: string) => void h.deletedBranches.push(branch),
}
vi.mock('@/features/library/actions/shared', () => ({
  gitPort: async () => ({ gitCore, BranchOpError: class extends Error {} }),
  ownerHandle: async () => 'owner-user',
}))
vi.mock('@/features/library/suggestion-core', () => ({
  reviewGates: async () => null,
  currentRevision: async () => 'rev',
  ensureBranchSuggestion: async () => ({}),
  mergeSuggestion: async () => ({ ok: true }),
}))
vi.mock('@/features/library/pr-settings', () => ({ withPrDefaults: () => h.prSettings }))

const { resolveBranchPr } = await import('@/features/library/actions/suggestion-branch')

/** Разрешение конфликтов: выбор по шагам приходит формой. */
const form = (steps: Record<string, 'ours' | 'theirs'> = {}) => {
  const fd = new FormData()
  fd.set('stepChoices', JSON.stringify(steps))
  fd.set('metaChoices', JSON.stringify({}))
  return fd
}

const run = async (): Promise<string> => {
  try {
    await resolveBranchPr('s1', form())
    return 'ok'
  } catch (e) {
    return (e as { redirectTo?: string }).redirectTo ?? 'ok'
  }
}

beforeEach(() => {
  Object.assign(h, { updates: [], merged: null, deletedBranches: [], redirects: [], newVersion: 7 })
  h.prSettings = { mergeMethod: 'merge', linearOnly: false, autoDeleteBranch: false }
  h.sug = {
    id: 's1',
    status: 'open',
    draft: false,
    branchRef: 'feature-1',
    note: 'правка',
    number: 5,
    authorId: 'author',
    templateId: 't1',
    template: { id: 't1', ownerId: 'owner', slug: 'spisok', currentVersion: 3, visibility: 'private', prSettings: {} },
  }
})

describe('слияние через разрешение конфликтов', () => {
  it('⚠️ записывает версию — иначе принятую правку нельзя откатить', async () => {
    await run()
    const accepted = h.updates.find((u) => u.status === 'accepted')
    expect(accepted, 'предложение обязано стать принятым').toBeTruthy()
    expect(accepted!.mergedVersion, 'версию берём у ядра, а не считаем сами').toBe(7)
  })

  it('версию берёт У ЯДРА, а не «текущая плюс один»', async () => {
    // Мы ПОПРОСИЛИ currentVersion + 1 = 4, ядро записало 9 — верно второе.
    h.newVersion = 9
    await run()
    expect(h.updates.find((u) => u.status === 'accepted')!.mergedVersion).toBe(9)
  })

  it('пустая версия от ядра не выдаётся за настоящую', async () => {
    h.newVersion = null
    await run()
    expect(h.updates.find((u) => u.status === 'accepted')!.mergedVersion).toBeNull()
  })

  it('удаляет ветку, когда так настроено, — как и обычный путь', async () => {
    h.prSettings = { mergeMethod: 'merge', linearOnly: false, autoDeleteBranch: true }
    await run()
    expect(h.deletedBranches).toEqual(['feature-1'])
  })

  it('без настройки ветку не трогает', async () => {
    await run()
    expect(h.deletedBranches).toEqual([])
  })
})

describe('исполняемые команды не проезжают через резолвер', () => {
  it('⚠️ разрушительная команда в результате слияния — отказ, и в main ничего не уходит', async () => {
    // Ровно тот сценарий: команда приезжает из чужой половины конфликта.
    gitCore.mergeState = async () => ({
      base: side(),
      ours: side(),
      theirs: { ...side([{ id: 'x', title: 'шаг', desc: '', why: '', command: 'rm -rf /', links: [] }]), tipSha: 'b' },
      mergeBaseSha: 'a',
    })

    const where = await run()

    // Отказ уходит теми же параметрами, что у редактора списка: причина и номер шага —
    // у стража есть готовый текст с обоими полями, и общий «не удалось» тут не годится.
    expect(where, 'причина отказа обязана быть названа').toContain('blocked=wipesFilesystem')
    expect(where, 'и номер шага тоже: человеку надо знать, где чинить').toContain('step=1')
    expect(h.merged, 'в ядро не должно уйти НИЧЕГО').toBeNull()
    expect(h.updates, 'предложение не становится принятым').toEqual([])
  })
})
