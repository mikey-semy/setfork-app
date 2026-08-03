import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, steps, templateVersions, templates, users } from '@/shared/db'
import { getListBlame } from '@/features/library/blame'

// Страница «Авторство» отвечает на один вопрос: когда этот пункт трогали в последний
// раз. Проверяется он только на реальной истории версий — здесь видно и правило
// сопоставления блоков, и то, все ли поля блока вообще доезжают из БД до сравнения.

let tplId = ''

type Block = {
  blockId?: string | null
  type?: string
  content?: Record<string, unknown>
  title?: Record<string, string>
  command?: string
  hasImage?: boolean
  imageKey?: string | null
  needsHuman?: boolean
  needsHumanAsk?: Record<string, string>
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${steps}, ${templateVersions}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'blame-owner' }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'bread', title: { ru: 'Хлеб' } })
    .returning({ id: templates.id })
  tplId = t.id
})

beforeEach(async () => {
  await db.delete(templateVersions).where(eq(templateVersions.templateId, tplId))
})

/** Версия списка со своими блоками; дата версии — детерминированная, по номеру. */
const addVersion = async (version: number, blocks: Block[]) => {
  const [v] = await db
    .insert(templateVersions)
    .values({
      templateId: tplId,
      version,
      note: `note v${version}`,
      createdAt: new Date(Date.UTC(2026, 0, version)),
    })
    .returning({ id: templateVersions.id })
  // Версия без блоков — законное состояние (удалили все пункты), и её строк нет.
  if (!blocks.length) {
    await db.update(templates).set({ currentVersion: version }).where(eq(templates.id, tplId))
    return
  }
  await db.insert(steps).values(
    blocks.map((b, i) => ({
      versionId: v.id,
      n: i + 1,
      blockId: b.blockId ?? null,
      type: b.type ?? 'step',
      content: b.content ?? {},
      title: b.title ?? {},
      command: b.command ?? '',
      hasImage: b.hasImage ?? false,
      imageKey: b.imageKey ?? null,
      needsHuman: b.needsHuman ?? false,
      needsHumanAsk: b.needsHumanAsk ?? {},
    })),
  )
  await db.update(templates).set({ currentVersion: version }).where(eq(templates.id, tplId))
}

// block_id в схеме — uuid; в тестах он адресуется коротким именем.
const ids = new Map<string, string>()
const uid = (name: string) => {
  const known = ids.get(name)
  if (known) return known
  const fresh = crypto.randomUUID()
  ids.set(name, fresh)
  return fresh
}

const step = (id: string, title: string, over: Block = {}): Block => ({ blockId: uid(id), title: { ru: title }, ...over })

/** Итог blame в проверяемом виде: номер пункта → версия последней правки. */
const lastVersions = async () => {
  const blame = await getListBlame(tplId)
  return blame!.steps.map((s) => s.lastVersion)
}

describe('blame по истории версий', () => {
  it('вставка блока в начало не делает соседей изменёнными', async () => {
    await addVersion(1, [step('a', 'A'), step('b', 'B')])
    await addVersion(2, [step('x', 'X'), step('a', 'A'), step('b', 'B')])
    expect(await lastVersions()).toEqual([2, 1, 1])
  })

  it('перестановка блоков не двигает дату последней правки', async () => {
    await addVersion(1, [step('a', 'A'), step('b', 'B'), step('c', 'C')])
    await addVersion(2, [step('c', 'C'), step('a', 'A'), step('b', 'B')])
    expect(await lastVersions()).toEqual([1, 1, 1])
  })

  it('правка содержимого презентационного блока видна', async () => {
    const text = (md: string) => ({ blockId: uid('t'), type: 'text', content: { md } })
    await addVersion(1, [step('a', 'A'), text('было')])
    await addVersion(2, [step('a', 'A'), text('стало')])
    expect(await lastVersions()).toEqual([1, 2])
  })

  it('смена изображения шага видна', async () => {
    await addVersion(1, [step('a', 'A', { hasImage: true, imageKey: 'old.png' })])
    await addVersion(2, [step('a', 'A', { hasImage: true, imageKey: 'new.png' })])
    expect(await lastVersions()).toEqual([2])
  })

  it('пометка «здесь нужен человек» видна', async () => {
    await addVersion(1, [step('a', 'A'), step('b', 'B')])
    await addVersion(2, [step('a', 'A'), step('b', 'B', { needsHuman: true, needsHumanAsk: { ru: 'почём у вас?' } })])
    expect(await lastVersions()).toEqual([1, 2])
  })

  it('дата и note берутся у версии последней правки, а не у текущей', async () => {
    await addVersion(1, [step('a', 'A'), step('b', 'B')])
    await addVersion(2, [step('a', 'A', { command: 'make' }), step('b', 'B')])
    const blame = await getListBlame(tplId)
    expect(blame!.currentVersion).toBe(2)
    expect(blame!.steps[0]).toMatchObject({ lastVersion: 2, note: 'note v2' })
    expect(blame!.steps[1]).toMatchObject({ lastVersion: 1, note: 'note v1' })
    expect(blame!.steps[1].lastAt.toISOString()).toBe(new Date(Date.UTC(2026, 0, 1)).toISOString())
  })

  it('история без block_id (данные до ADR-0013) сопоставляется по подписи', async () => {
    const plain = (title: string): Block => ({ title: { ru: title } })
    await addVersion(1, [plain('A'), plain('B')])
    await addVersion(2, [plain('X'), plain('A'), plain('B')])
    expect(await lastVersions()).toEqual([2, 1, 1])
  })

  it('версии выше текущей в ответ не попадают', async () => {
    await addVersion(1, [step('a', 'A')])
    await addVersion(2, [step('a', 'A', { command: 'make' })])
    await db.update(templates).set({ currentVersion: 1 }).where(eq(templates.id, tplId))
    const blame = await getListBlame(tplId)
    expect(blame!.currentVersion).toBe(1)
    expect(blame!.steps.map((s) => s.lastVersion)).toEqual([1])
  })

  it('версия без блоков не выпадает из истории: возврат пункта — это изменение', async () => {
    await addVersion(1, [step('a', 'A')])
    await addVersion(2, [])
    await addVersion(3, [step('a', 'A')])
    expect(await lastVersions()).toEqual([3])
  })

  it('у текущей версии нет блоков — пустой ответ, а не блоки прошлой версии', async () => {
    await addVersion(1, [step('a', 'A')])
    await addVersion(2, [])
    const blame = await getListBlame(tplId)
    expect(blame).toMatchObject({ currentVersion: 2, steps: [] })
  })

  it('несуществующий список — null, а не пустой ответ', async () => {
    expect(await getListBlame('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
