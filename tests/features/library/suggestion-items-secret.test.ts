import { describe, expect, it, vi } from 'vitest'

/**
 * ПРАВКА ПРЕДЛОЖЕНИЯ НЕ ПИШЕТ КЛЮЧ ДОСТУПА В ВЕТКУ ЧУЖОГО СПИСКА.
 *
 * Подача предложения проверяется, но уже поданное правят на сайте — и этот путь
 * (`writeSuggestionItems`, общий для «править» и «применить предложенную правку»)
 * писал в ветку мимо проверки (находка ревью). Подменены сессия, база и ядро — внешние
 * края; правило и путь до записи настоящие.
 */
const h = vi.hoisted(() => ({ wrote: 0 }))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`переход вместо значения: ${to}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: 'author', handle: 'author' }) }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/db', () => ({
  db: {
    query: {
      suggestions: {
        findFirst: async () => ({
          id: 's1',
          number: 1,
          status: 'open',
          authorId: 'author',
          coauthorIds: [],
          branchRef: 'refs/heads/pr/1',
          template: { id: 't1', ownerId: 'owner', slug: 'spisok', currentVersion: 3, archivedAt: null, frozenAt: null },
        }),
      },
    },
    // Чтения (ник владельца для адреса) — одна строка; права автора правки базу не спрашивают.
    select: () => {
      const chain: Record<string, unknown> = {}
      for (const k of ['from', 'where', 'innerJoin', 'leftJoin', 'limit', 'orderBy']) chain[k] = () => chain
      chain.then = (ok: (v: unknown[]) => unknown) => ok([{ handle: 'owner' }])
      return chain
    },
    update: () => {
      h.wrote++
      throw new Error('запись дошла до базы')
    },
  },
  blockComments: {},
  blockCommentThreads: {},
  suggestionReviews: {},
  suggestions: {},
  collaborators: {},
  users: {},
}))
vi.mock('@/features/git/core', () => ({
  gitCore: {
    commitToBranch: async () => {
      h.wrote++
      throw new Error('запись дошла до ядра')
    },
  },
}))

const { updateSuggestionItems } = await import('@/features/library/actions/suggestion-items')

describe('правка предложения с ключом доступа', () => {
  it('отказ значением `secret`, до ядра и базы запись не доходит', async () => {
    const tail = Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join('')
    const fd = new FormData()
    fd.set('items', JSON.stringify([{ type: 'step', title: 'Настроить', command: `export KEY=${['sk', 'or', 'v1', tail].join('-')}` }]))
    expect(await updateSuggestionItems('s1', null, fd)).toBe('secret')
    expect(h.wrote).toBe(0)
  })
})
