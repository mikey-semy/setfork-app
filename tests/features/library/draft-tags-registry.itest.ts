import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ТЕГ, ЗАВЕДЁННЫЙ В ЧЕРНОВИКЕ, ПОПАДАЕТ В РЕЕСТР — С ЛЮБОГО ВХОДА.
 *
 * Реестр тегов пополнял ВЫЗЫВАЮЩИЙ, и рядом стояло объяснение: границы слоёв не дают
 * features/library тянуть features/tags. Объяснение верное, решение — нет: вызывающих
 * оказалось двое, веб звал, MCP нет. Тег, заведённый ассистентом, не появлялся ни в
 * каталоге, ни в подсказках — при том, что у списка он стоял (находка авто-ревью по #812).
 *
 * Теперь реестр пополняет сама публикация черновика, а слой связывает порт из
 * composition root — как уже сделано для модерации и индекса. Тест держит именно это:
 * публикуем ЧЕРЕЗ общую точку и проверяем реестр.
 *
 * Требует живого ядра: публикация идёт обычным путём записи, через git-коммит.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const { db, tags, templates, users } = await import('@/shared/db')
const { registerTagsRegistrar, publishDraftFor, upsertDraft } = await import('@/features/library/draft')
const { registerTags } = await import('@/features/tags/service')
const { listStore } = await import('@/features/library/list-store')

let ownerId = ''

description('теги черновика попадают в реестр', () => {
  beforeAll(async () => {
    await resetTables([templates, users, tags])
    const [u] = await db.insert(users).values({ handle: 'tagger', email: 'tagger@x.dev', name: 'T' }).returning({ id: users.id })
    ownerId = u.id
    // Порт связывает composition root; в тесте связываем так же, иначе проверялась бы
    // не публикация, а наличие заглушки.
    registerTagsRegistrar(registerTags)
  })

  it('новый тег из черновика оказывается в реестре после публикации', async () => {
    const created = (await listStore.create({
      ownerId,
      slug: 'tag-probe',
      title: { en: 'tag probe' },
      desc: {},
      tags: [],
      status: 'published',
      steps: [
        {
          n: 1, type: 'step', content: {}, blockId: null, title: { en: 'шаг' }, desc: {}, command: '',
          level: 'required', why: {}, needsHuman: false, needsHumanAsk: {}, section: {}, subtasks: [], refs: [], imageRef: null,
        },
      ],
    } as never)) as { id: string }
    const [tpl] = await db.select().from(templates).where(eq(templates.id, created.id))

    await upsertDraft(tpl as never, ownerId, {
      items: [{ title: { en: 'шаг' }, desc: {}, command: '', hasImage: false, level: 'required', why: {}, section: {}, subtasks: [], refs: [] }] as never,
      meta: { tags: ['совсем-новый-тег'] },
      note: 'из черновика',
    })

    const res = await publishDraftFor(tpl as never, ownerId)
    expect(res).not.toHaveProperty('error')

    const registered = await db.select({ slug: tags.slug }).from(tags).where(eq(tags.slug, 'совсем-новый-тег'))
    expect(registered).toHaveLength(1)
  })
})
