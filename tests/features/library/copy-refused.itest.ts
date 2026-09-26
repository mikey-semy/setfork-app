import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * КОПИЯ СПИСКА, ГДЕ ЛЕЖИТ ТО, ЧТО СЕЙЧАС НЕ ПРИНИМАЕТСЯ (команда легла в базу до проверки).
 * Раньше форк и «из шаблона» падали исключением — безымянная страница ошибки. Теперь форк
 * возвращает причину, а «из шаблона» ведёт на исходный список с `?e=copy-refused`.
 * Настоящие база и ядро; подменены сессия и переходы Next.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { to })
  },
}))

const { db, users, templates, templateVersions, steps } = await import('@/shared/db')
const { forkTemplate, useTemplate } = await import('@/features/library/actions/forks')

description('копия списка со старой опасной командой', () => {
  let srcId = ''
  let otherId = ''
  beforeAll(async () => {
    await resetTables([steps, templateVersions, templates, users])
    const [o] = await db.insert(users).values({ handle: 'legacy-owner' }).returning({ id: users.id })
    const [x] = await db.insert(users).values({ handle: 'legacy-forker' }).returning({ id: users.id })
    otherId = x.id
    const [t] = await db
      .insert(templates)
      .values({ ownerId: o.id, slug: 'legacy', title: { ru: 'Старый' }, status: 'published', visibility: 'public', isTemplate: true, currentVersion: 1 })
      .returning({ id: templates.id })
    srcId = t.id
    const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
    await db.insert(steps).values({ versionId: v.id, n: 1, title: { ru: 'Снести' }, command: 'rm -rf /' })
  })

  it('форк — причина значением, копии нет', async () => {
    h.session = { userId: otherId, handle: 'legacy-forker' }
    const res = await forkTemplate(srcId)
    expect(res).toEqual({ error: expect.stringContaining('Копия не создана') })
    expect(await db.select().from(templates).where(eq(templates.ownerId, otherId))).toEqual([])
  })

  it('«из шаблона» — на исходный список с объяснением', async () => {
    h.session = { userId: otherId, handle: 'legacy-forker' }
    const err = await useTemplate(srcId).catch((e) => e as { to?: string })
    expect((err as { to?: string }).to).toBe('/legacy-owner/legacy?e=copy-refused')
  })
})
