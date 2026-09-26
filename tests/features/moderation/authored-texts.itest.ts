import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// ФАЙЛЫ АВТОРА В ТЕКСТЕ ДЛЯ МОДЕРАЦИИ. База настоящая; подменено только ядро — внешний
// край, у которого приложение берёт файлы дерева (`gitCore.authoredFiles`). Проверяется
// то, что делает приложение: тексты `references/`/`scripts/` доходят до классификатора
// ПОСЛЕ блоков, а недоступное ядро не роняет проверку блоков.
const h = vi.hoisted(() => ({ files: null as null | { path: string; text: string }[], asked: [] as unknown[] }))
vi.mock('@/features/git/core', () => ({
  gitCore: {
    authoredFiles: async (repo: unknown, version: number) => {
      h.asked.push({ repo, version })
      if (!h.files) throw new Error('core is down')
      return h.files.map((f) => ({ path: f.path, content: new TextEncoder().encode(f.text), executable: false }))
    },
  },
}))

const { db, templates, templateVersions, steps, users } = await import('@/shared/db')
const { buildListText } = await import('@/features/moderation/moderate-list')

let listId = ''

beforeEach(async () => {
  await resetTables([steps, templateVersions, templates, users])
  h.files = []
  h.asked = []
  const [o] = await db.insert(users).values({ handle: 'skiller' }).returning({ id: users.id })
  const [t] = await db.insert(templates).values({ ownerId: o.id, slug: 'guard', title: { en: 'Guard' } }).returning({ id: templates.id })
  listId = t.id
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 3 }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: 'Install the hook' } })
})
afterAll(async () => {
  await resetTables([steps, templateVersions, templates, users])
})

describe('модерация видит файлы автора', () => {
  it('тексты файлов — в тексте проверки, после блоков, с путём; спрошена последняя версия списка', async () => {
    h.files = [{ path: 'references/howto.md', text: 'Step by step how-to' }]
    const text = await buildListText(listId)
    expect(text).toContain('[references/howto.md]\nStep by step how-to')
    expect(text.indexOf('Install the hook')).toBeLessThan(text.indexOf('references/howto.md'))
    expect(h.asked).toEqual([{ repo: { owner: 'skiller', slug: 'guard' }, version: 3 }])
  })

  it('ядро не ответило — блоки всё равно проверяются', async () => {
    h.files = null
    const text = await buildListText(listId)
    expect(text).toContain('Install the hook')
    expect(text).not.toContain('[')
  })
})
