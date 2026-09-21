// АРХИВ И ЗАМОРОЗКА НАЗЫВАЮТСЯ ЧЕЛОВЕКУ, А НЕ ПОКАЗЫВАЮТСЯ БЕЗЫМЯННОЙ СТРАНИЦЕЙ.
//
// «Вернуть эту версию» и «Принять правку» `canEditList` не спрашивают вовсе — у них
// нет своего гейта, и барьер на единой точке записи версии для них ЕДИНСТВЕННАЯ
// проверка. Барьер бросал обычный `Error`, а оба экшена ловят `ListWriteError`:
// на архивном списке кнопка кончалась страницей ошибки без причины.
//
// Проверяем путь человека с двух концов: (1) барьер отдаёт отказ той формы, которую
// экшены ловят, и версию не пишет; (2) у каждого кода отказа есть свой текст на
// странице предложения — иначе причина доезжает до страницы и падает в общий
// «не удалось выполнить merge».
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { archivedAt: null as Date | null, frozenAt: null as Date | null },
  written: 0,
}))

// drizzle — частично: `eq`/`and` заменяем заглушками (колонок в моке базы нет), всё
// остальное настоящее, иначе соседние модули не соберутся на импорте.
vi.mock('drizzle-orm', async (orig) => ({
  ...(await orig<typeof import('drizzle-orm')>()),
  eq: () => ({}),
  and: () => ({}),
}))
vi.mock('@/shared/db', () => ({
  templates: {},
  templateVersions: {},
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [h.state] }) }) }),
  },
}))
vi.mock('@/features/library/list-store.adapter', () => ({ listStore: {} }))
vi.mock('@/features/library/list-store.remote', () => ({
  listReadRemote: {},
  listWriteRemote: {
    addVersion: async () => {
      h.written++
      return { version: 2 }
    },
    create: async () => ({ id: 'x' }),
  },
}))
vi.mock('@/shared/moderation/publication-state', () => ({ initialModeration: async () => 'active' }))
vi.mock('@/shared/observability', () => ({ captureError: () => {} }))

const { listStore } = await import('@/features/library/list-store')
const { ListWriteError } = await import('@/core')
const { MERGE_ERR } = await import('@/app/[handle]/[slug]/suggestions/[id]/merge-err')
const { VERSION_ERR } = await import('@/features/library/version-error')
const { LIST_WRITE_CODES } = await import('@/core/ports')

const addVersion = () => listStore.addVersion('tpl-1', { note: 'revert to v1', steps: [], authorId: 'u1' })

describe('барьер версии называет причину', () => {
  it('архивный список: отказ той формы, которую ловят экшены — и с кодом archived', async () => {
    h.state = { archivedAt: new Date(), frozenAt: null }
    h.written = 0
    const err = await addVersion().then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ListWriteError)
    expect((err as InstanceType<typeof ListWriteError>).code).toBe('archived')
    // Версия при этом не пишется — барьер именно барьер, а не сообщение.
    expect(h.written).toBe(0)
  })

  it('замороженный список: код frozen, а не общий «archived»', async () => {
    h.state = { archivedAt: null, frozenAt: new Date() }
    const err = await addVersion().then(
      () => null,
      (e) => e,
    )
    expect((err as InstanceType<typeof ListWriteError>).code).toBe('frozen')
  })

  it('живой список барьер пропускает', async () => {
    h.state = { archivedAt: null, frozenAt: null }
    h.written = 0
    await expect(addVersion()).resolves.toEqual({ version: 2 })
    expect(h.written).toBe(1)
  })
})

/**
 * Узда ПО КОНСТРУКЦИИ, а не по найденному: список кодов берётся из самого типа
 * отказа. Заведи новый код — и обе поверхности обязаны уметь его назвать, иначе
 * тест красный. Перечислять «archived и frozen» здесь руками значило бы поймать
 * сегодняшнюю дыру и пропустить завтрашнюю.
 *
 * Исключения названы поимённо и каждое про смысл, а не про «сейчас не работает»:
 *  • `exists` — отказ РОЖДЕНИЯ списка. Ни «Принять правку», ни «Вернуть версию»
 *    списков не создают, и до этих двух страниц код дойти не может.
 *  • `stale` на странице истории — откат собирает версию сам и `expectedVersion`
 *    не шлёт, так что просить у него текст не за что.
 */
const NEVER: Record<'suggestion' | 'versions', Set<string>> = {
  suggestion: new Set(['exists']),
  versions: new Set(['exists', 'stale']),
}

describe('у каждого отказа записи есть свой текст для человека', () => {
  it('страница предложения: ни один код не падает в общий «не удалось»', () => {
    expect(LIST_WRITE_CODES.filter((c) => !NEVER.suggestion.has(c) && !MERGE_ERR[c])).toEqual([])
  })

  it('страница истории версий: ни один код не остаётся без плашки', () => {
    expect(LIST_WRITE_CODES.filter((c) => !NEVER.versions.has(c) && !VERSION_ERR[c])).toEqual([])
  })
})
