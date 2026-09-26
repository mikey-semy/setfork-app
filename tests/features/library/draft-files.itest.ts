import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ФАЙЛЫ СКИЛЛА ИЗ РЕДАКТОРА САЙТА — путём человека: форма → `saveDraft`/`publishEdits` →
 * черновик → настоящее ядро → файлы читаются из дерева версии.
 *
 * Что ломается молча и потому проверяется:
 *  • «не трогали» ≠ «убрали все»: форма без поля `authored` обязана ОСТАВИТЬ файлы (их
 *    переносит ядро), а `[]` — стереть. Спутать их значило бы удалить набор у каждого,
 *    кто правил только шаги;
 *  • правка файлов в черновике переживает сохранение без поля (второе «Сохранить» или
 *    запись агента в тот же черновик) — иначе правка пропадала бы между сохранениями;
 *  • опасное в скрипте — предупреждение при сохранении и отказ при публикации, оба
 *    называют ФАЙЛ, а не «шаг 0»; черновик после отказа цел.
 *
 * Настоящие база и ядро; подменены сессия и переходы Next.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { to })
  },
}))

const { db, templates, users, listDrafts } = await import('@/shared/db')
const { mcpPublishSkill } = await import('@/features/mcp/tools/lists/skill')
const { saveDraft, publishEdits } = await import('@/features/library/actions')
const { gitCore } = await import('@/features/git/core')
const { coreCapabilities } = await import('@/shared/core-capabilities')

const HANDLE = 'files-editor'
const SLUG = 'edited-skill'
const RUN = { path: 'scripts/run.sh', content: '#!/bin/sh\necho hello\n', executable: true }
const GUIDE = { path: 'references/guide.md', content: '# Guide\n' }

const tplRow = async () => {
  const [r] = await db.select({ id: templates.id, v: templates.currentVersion }).from(templates).where(eq(templates.slug, SLUG))
  return r
}
const filesAt = async (version: number) =>
  ((await gitCore.authoredFiles({ owner: HANDLE, slug: SLUG }, version)) ?? [])
    .map((f) => ({ path: f.path, text: new TextDecoder().decode(f.content), executable: f.executable }))
    .sort((a, b) => a.path.localeCompare(b.path))
const draftFiles = async (tplId: string) => (await db.select({ authored: listDrafts.authored }).from(listDrafts).where(eq(listDrafts.templateId, tplId)))[0]?.authored

/** Форма редактора: шаги, признак черновика и — если трогали — набор файлов. */
async function form(files?: { path: string; text: string; executable: boolean }[]) {
  const { id, v } = await tplRow()
  const [d] = await db.select({ id: listDrafts.id, rev: listDrafts.rev }).from(listDrafts).where(eq(listDrafts.templateId, id))
  const fd = new FormData()
  fd.set('items', JSON.stringify([{ type: 'step', title: 'Run it', command: 'sh scripts/run.sh' }]))
  fd.set('draftRef', `${v}@${d ? `${d.id}:${d.rev}` : 'none'}`)
  if (files) fd.set('authored', JSON.stringify(files))
  return { id, fd }
}
const to = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as { to?: string }).to ?? ''

description('файлы скилла в редакторе сайта', () => {
  let accepts = false
  beforeAll(async () => {
    await resetTables([listDrafts, templates, users])
    const [u] = await db.insert(users).values({ handle: HANDLE }).returning({ id: users.id })
    h.session = { userId: u.id, handle: HANDLE }
    accepts = (await coreCapabilities())?.acceptsAuthoredFiles === true
    await mcpPublishSkill(u.id, { title: 'Edited skill', items: [{ title: 'Run it', command: 'sh scripts/run.sh' }], files: accepts ? [RUN, GUIDE] : [] })
  })

  it('правка файлов лежит в черновике и переживает сохранение без поля', async () => {
    if (!accepts) return
    const edited = [
      { path: 'scripts/run.sh', text: '#!/bin/sh\necho edited\n', executable: true },
      { path: 'references/new.md', text: '# New\n', executable: false },
    ]
    const first = await form(edited)
    expect(await to(saveDraft(first.id, first.fd))).toMatch(/\/edit\?saved=1$/)
    // Второе «Сохранить», не трогая файлы: поля нет — правка файлов остаётся.
    const second = await form()
    await to(saveDraft(second.id, second.fd))
    expect(await draftFiles(first.id)).toEqual(edited)
  })

  it('публикация несёт набор из черновика ОДНОЙ версией с шагами', async () => {
    if (!accepts) return
    const { id, fd } = await form()
    expect(await to(publishEdits(id, fd))).toBe(`/${HANDLE}/${SLUG}`)
    const { v } = await tplRow()
    expect(v).toBe(2)
    expect(await filesAt(2)).toEqual([
      { path: 'references/new.md', text: '# New\n', executable: false },
      { path: 'scripts/run.sh', text: '#!/bin/sh\necho edited\n', executable: true },
    ])
    expect(await draftFiles(id)).toBeUndefined()
  })

  it('файлы не трогали — ядро переносит набор родителя как есть', async () => {
    if (!accepts) return
    const { id, fd } = await form()
    await to(publishEdits(id, fd))
    expect((await tplRow()).v).toBe(3)
    expect(await filesAt(3)).toEqual(await filesAt(2))
  })

  it('опасное в скрипте: сохранение предупреждает, публикация отказывает — оба называют файл', async () => {
    if (!accepts) return
    const bad = [{ path: 'scripts/clean.py', text: 'import os\nos.system("rm -rf /")\n', executable: true }]
    const saved = await form(bad)
    expect(await to(saveDraft(saved.id, saved.fd))).toContain('warn=destructive&step=0&file=scripts%2Fclean.py')
    const pub = await form(bad)
    expect(await to(publishEdits(pub.id, pub.fd))).toMatch(/\/edit\?blocked=\w+&step=0&file=scripts%2Fclean\.py$/)
    // Версии нет, черновик с правкой цел.
    expect((await tplRow()).v).toBe(3)
    expect(await draftFiles(pub.id)).toEqual(bad)
  })

  it('пустой набор — все файлы убраны, а не «не трогали»', async () => {
    if (!accepts) return
    const { id, fd } = await form([])
    await to(publishEdits(id, fd))
    expect((await tplRow()).v).toBe(4)
    expect(await filesAt(4)).toEqual([])
  })

  it('поле в обход формы (путь мимо правила) — отказ без записи', async () => {
    const { id, fd } = await form([{ path: 'scripts/sub/x.sh', text: 'x', executable: false }])
    expect(await to(saveDraft(id, fd))).toMatch(/\/edit\?e=files-bad$/)
  })
})
