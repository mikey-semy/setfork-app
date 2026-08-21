import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОЛНАЯ ЗАМЕНА С `publish:false` КОПИТСЯ В РАБОЧЕЙ КОПИИ — И У ОПУБЛИКОВАННОГО СПИСКА.
 *
 * Обещание контракта («правки копятся, версия рождается осознанным действием», ADR-0020)
 * дважды расходилось с кодом, и оба раза это нашло авто-ревью:
 *
 * #811 — флага не было в схеме вовсе: агент просил не создавать версию, а получал её.
 * #812 — флаг появился, но путь стерёг гейт, требовавший статус «черновик»: у
 *        опубликованного списка накопить замену было нельзя. И мета (`tags`, `ordered`)
 *        принималась, но в черновик не сохранялась — публикация молча возвращала старые.
 *
 * Требует живого ядра: публикация черновика идёт обычным путём записи, через git-коммит.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const описание = CORE ? describe : describe.skip

const { db, listDrafts, templates, users } = await import('@/shared/db')
const { mcpCreateList } = await import('@/features/mcp/tools/lists/create')
const { mcpUpdateList, mcpPublishDraft } = await import('@/features/mcp/tools/lists/edit')

let ownerId = ''
const HANDLE = 'holder'

/** Опубликованный список с одним пунктом. */
const published = async (title: string) => {
  const made = (await mcpCreateList(ownerId, { title, items: [{ title: 'первый' }] })) as { ref: string }
  const slug = made.ref.split('/')[1]
  await db.update(templates).set({ status: 'published' }).where(eq(templates.slug, slug))
  return slug
}

const listRow = async (slug: string) => {
  const [row] = await db
    .select({ id: templates.id, version: templates.currentVersion, tags: templates.tags, ordered: templates.ordered })
    .from(templates)
    .where(eq(templates.slug, slug))
  return row
}

описание('update_list с publish:false', () => {
  beforeAll(async () => {
    await resetTables([templates, users])
    const [u] = await db.insert(users).values({ handle: HANDLE, email: 'holder@x.dev', name: 'H' }).returning({ id: users.id })
    ownerId = u.id
  })

  it('у ОПУБЛИКОВАННОГО списка замена копится, а не публикуется', async () => {
    const slug = await published('Hold published')
    const before = await listRow(slug)

    const res = (await mcpUpdateList(ownerId, HANDLE, slug, {
      items: [{ title: 'заменённый' }],
      publish: false,
    })) as { status?: string; error?: string }
    expect(res.error).toBeUndefined()
    expect(res.status).toBe('pending')

    // Версия НЕ создана: живой список остался прежним.
    const after = await listRow(slug)
    expect(after.version).toBe(before.version)
    const [draft] = await db.select().from(listDrafts).where(eq(listDrafts.templateId, after.id))
    expect(draft.items).toHaveLength(1)
  })

  it('теги и порядок доезжают до версии при публикации накопленного', async () => {
    const slug = await published('Hold meta')
    const res = (await mcpUpdateList(ownerId, HANDLE, slug, {
      items: [{ title: 'с мета' }],
      tags: ['докер', 'бэкап'],
      ordered: false,
      publish: false,
    })) as { error?: string }
    expect(res.error).toBeUndefined()

    // Публикуем накопленное тем же инструментом, каким это делает агент.
    const preview = (await mcpPublishDraft(ownerId, HANDLE, slug)) as { published?: boolean }
    expect(preview.published).toBe(false)
    const done = (await mcpPublishDraft(ownerId, HANDLE, slug, 'из черновика', true)) as { error?: string }
    expect(done.error).toBeUndefined()

    const after = await listRow(slug)
    // Мета запрошена вместе с составом — значит и применяться обязана вместе с ним.
    expect(after.tags).toEqual(['докер', 'бэкап'])
    expect(after.ordered).toBe(false)
  })
})
