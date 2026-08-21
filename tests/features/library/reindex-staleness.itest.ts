import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * УСТАРЕВШИЙ ПРОХОД НЕ ЗАТИРАЕТ СВЕЖИЙ.
 *
 * Публикация ставит переиндексацию поверх уже идущей, и порядок завершения очередью не
 * гарантирован. Проход, собравший список ещё ЧЕРНОВИКОМ, дописывался последним и стирал
 * публичный эмбеддинг — список исчезал из смыслового поиска, хотя проход только что был
 * (находка авто-ревью по #819).
 *
 * Замка тут быть не может: между сбором и записью идёт вызов модели. Поэтому проверяется
 * сверка снимка: состояние списка, изменившееся за время прохода, отменяет запись.
 */
const { db, embeddings, templates, templateVersions, steps, users } = await import('@/shared/db')

/**
 * Векторы не считаем — проверяется решение «писать или не писать». Первый вызов при этом
 * ЗАДЕРЖИВАЕТСЯ до сигнала: только так два прохода накладываются по-настоящему, а не
 * «по очереди, но быстро». Без наложения проверка была пустой — это показала мутация.
 */
const h = vi.hoisted(() => {
  let open: (() => void) | null = null
  const gate = new Promise<void>((r) => {
    open = r
  })
  // Задержку ВЗВОДИМ явно: иначе первый же проход любого теста повиснет на воротах.
  return { gate, open: () => open?.(), armed: false }
})
vi.mock('@/shared/ai/embeddings', () => ({
  embedTexts: async (xs: string[]) => {
    if (h.armed) {
      h.armed = false
      await h.gate
    }
    return xs.map(() => null)
  },
}))
const { reindexList } = await import('@/features/library/reindex')

let ownerId = ''

const mkList = async (status: 'draft' | 'published') => {
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: `l-${Date.now()}`, title: { en: 'list' }, desc: {}, tags: [], status, visibility: 'public', currentVersion: 1 } as never)
    .returning({ id: templates.id })
  const [ver] = await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'seed' } as never).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: ver.id, n: 1, title: { en: 'шаг' }, desc: {}, command: '' } as never)
  return tpl.id
}

beforeEach(async () => {
  await resetTables([templates, users, embeddings])
  const [u] = await db.insert(users).values({ handle: 'idx', email: 'idx@x.dev', name: 'I' }).returning({ id: users.id })
  ownerId = u.id
})

describe('переиндексация и устаревший снимок', () => {
  it('список не менялся — эмбеддинги записываются', async () => {
    const id = await mkList('published')

    await reindexList(id)

    expect(await db.select().from(embeddings).where(eq(embeddings.refId, id))).not.toHaveLength(0)
  })

  it('устаревший проход не затирает свежий', async () => {
    const id = await mkList('published')

    // Первый проход собрал состав ИЗ ОДНОГО шага и замер на вызове модели.
    h.armed = true
    const stale = reindexList(id)
    await new Promise((r) => setTimeout(r, 50))

    // Пока он ждёт, список уехал вперёд: добавился второй шаг.
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, id))
    await db.insert(steps).values({ versionId: ver.id, n: 2, title: { en: 'второй' }, desc: {}, command: '' } as never)
    await db.update(templates).set({ updatedAt: new Date() }).where(eq(templates.id, id))
    await reindexList(id) // свежий проход записал ДВА элемента
    const fresh = await db.select().from(embeddings).where(eq(embeddings.refId, id))
    expect(fresh.length).toBeGreaterThan(1)

    // Теперь устаревший договаривает — и не должен подменить свежее своим однушаговым.
    h.open()
    await stale

    const after = await db.select().from(embeddings).where(eq(embeddings.refId, id))
    expect(after.length).toBe(fresh.length)
  })
})
