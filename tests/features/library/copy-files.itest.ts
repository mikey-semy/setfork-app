import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * КОПИЯ СОДЕРЖИМОГО НЕСЁТ ФАЙЛЫ АВТОРА — на настоящем ядре.
 *
 *  • «Вернуть версию» возвращает файлы ТОЙ версии: запись переносит набор из текущей, и
 *    без этого откат к v1 оставлял бы файлы v2 рядом с шагами v1;
 *  • форк и «использовать как шаблон» копируют файлы и метку «скилл»: форк скилла без
 *    `scripts/` — уже не тот скилл, а заметить потерю можно только по сломанной установке.
 *
 * Подменены только сессия и переходы Next (действия уводят страницу).
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { to })
  },
}))

const { db, templates, users, listDrafts } = await import('@/shared/db')
const { mcpPublishSkill } = await import('@/features/mcp/tools/lists/skill')
const { gitCore } = await import('@/features/git/core')
const { revertToVersion } = await import('@/features/library/actions/versions')
const { forkTemplate, useTemplate } = await import('@/features/library/actions/forks')

const OWNER = 'copy-owner'
const OTHER = 'copy-other'
let ownerId = ''
let otherId = ''

const RUN = { path: 'scripts/run.sh', content: '#!/bin/sh\necho hello\n', executable: true }
const GUIDE = { path: 'references/guide.md', content: '# Guide\n' }

const row = async (owner: string, slug: string) => {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, owner))
  const all = await db.select().from(templates).where(eq(templates.ownerId, u.id))
  return all.find((t) => t.slug === slug)
}
const filesAt = async (owner: string, slug: string, version: number) =>
  ((await gitCore.authoredFiles({ owner, slug }, version)) ?? []).map((f) => f.path).sort()
/** Действие уходит переходом — это успех; иная ошибка — настоящая. */
const acting = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    if (!(e as { to?: string }).to) throw e
  }
}

description('копия содержимого несёт файлы автора', () => {
  beforeAll(async () => {
    await resetTables([listDrafts, templates, users])
    ;[{ id: ownerId }] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
    ;[{ id: otherId }] = await db.insert(users).values({ handle: OTHER }).returning({ id: users.id })
    // v1: только скрипт; v2: + справка.
    await mcpPublishSkill(ownerId, { title: 'Copy skill', items: [{ title: 'Run it' }], files: [RUN] })
    const v1 = (await row(OWNER, 'copy-skill'))!.currentVersion
    await mcpPublishSkill(ownerId, { list: `${OWNER}/copy-skill`, baseVersion: v1, files: [GUIDE] })
    // Опубликовать и сделать шаблоном — это настройки, их проверяют другие тесты.
    await db.update(templates).set({ status: 'published', visibility: 'public', moderation: 'active', isTemplate: true }).where(eq(templates.slug, 'copy-skill'))
  })

  it('«Вернуть версию» возвращает и файлы той версии', async () => {
    const tpl = (await row(OWNER, 'copy-skill'))!
    expect(await filesAt(OWNER, 'copy-skill', tpl.currentVersion)).toEqual(['references/guide.md', 'scripts/run.sh'])
    h.session = { userId: ownerId, handle: OWNER }
    await acting(revertToVersion(tpl.id, tpl.currentVersion - 1))
    const after = (await row(OWNER, 'copy-skill'))!
    expect(after.currentVersion).toBe(tpl.currentVersion + 1)
    expect(await filesAt(OWNER, 'copy-skill', after.currentVersion)).toEqual(['scripts/run.sh'])
  })

  it('форк копирует файлы и метку «скилл»', async () => {
    const src = (await row(OWNER, 'copy-skill'))!
    h.session = { userId: otherId, handle: OTHER }
    await acting(forkTemplate(src.id))
    const fork = (await row(OTHER, 'copy-skill'))!
    expect(fork.isSkill).toBe(true)
    expect(await filesAt(OTHER, 'copy-skill', fork.currentVersion)).toEqual(await filesAt(OWNER, 'copy-skill', src.currentVersion))
  })

  it('«использовать как шаблон» копирует файлы и метку', async () => {
    const src = (await row(OWNER, 'copy-skill'))!
    h.session = { userId: ownerId, handle: OWNER }
    await acting(useTemplate(src.id))
    const copy = (await row(OWNER, 'copy-skill-copy'))!
    expect(copy.isSkill).toBe(true)
    expect(await filesAt(OWNER, 'copy-skill-copy', copy.currentVersion)).toEqual(await filesAt(OWNER, 'copy-skill', src.currentVersion))
  })
})
