import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * «СООБЩИТЬ В СПИСОК» С ВСТАВШЕГО ШАГА — ЭТО ОБЫЧНАЯ ЗАДАЧА, А НЕ ОСОБЕННАЯ.
 *
 * Путь писался отдельно от формы «Новый вопрос» и потерял по дороге всё, кроме самой
 * записи:
 *
 *  • ⚠️ УВЕДОМЛЕНИЙ НЕ БЫЛО ВОВСЕ. Человек упирался в шаг, нажимал «сообщить», задача
 *    появлялась — и владелец списка не узнавал о ней, пока сам не заглянет в трекер.
 *    Для петли обратной связи это отменяет саму петлю: сообщение доходит до хранилища,
 *    но не до того, кто может починить.
 *  • раздел «Вопросы», выключенный владельцем, не проверялся: задача заводилась туда,
 *    где раздела нет и где её не видно никому;
 *  • счётчика частоты не было тоже.
 *
 * Проверяем на реальной базе то, что видно снаружи: уведомление владельцу и отказ
 * СЛОВАМИ при выключенном разделе.
 */
const h = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: h.userId, handle: 'runner' }),
  getSession: async () => ({ userId: h.userId, handle: 'runner' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { redirectTo: to })
  },
}))

const { db, issues, notifications, runStepState, runs, steps, templateVersions, templates, users } = await import('@/shared/db')
const { reportBlockedStep } = await import('@/features/runs/actions')

let ownerId = ''
let templateId = ''
let runId = ''
let stepId = ''

/** Успех уходит редиректом, отказ — значением: возвращаем то, что случилось. */
const report = async (): Promise<string> => {
  try {
    return (await reportBlockedStep(runId, stepId)) ?? 'ok'
  } catch (e) {
    const to = (e as { redirectTo?: string }).redirectTo
    if (!to) throw e
    return to
  }
}

beforeEach(async () => {
  await resetTables([runStepState, runs, issues, notifications, steps, templateVersions, templates, users])
  const rows = await db
    .insert(users)
    .values([{ handle: 'rb-owner' }, { handle: 'rb-runner' }])
    .returning({ id: users.id, handle: users.handle })
  const byHandle = (handle: string) => {
    const row = rows.find((r) => r.handle === handle)
    if (!row) throw new Error(`не завёлся пользователь ${handle}`)
    return row.id
  }
  ownerId = byHandle('rb-owner')
  h.userId = byHandle('rb-runner')

  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'blocked-list', title: { en: 'Blocked list' }, currentVersion: 1 })
    .returning({ id: templates.id })
  templateId = tpl.id
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId, version: 1, authorId: ownerId })
    .returning({ id: templateVersions.id })
  const [st] = await db
    .insert(steps)
    // Шаг принадлежит ВЕРСИИ, а не списку напрямую: версия — полный снимок блоков.
    .values({ versionId: ver.id, n: 3, title: { en: 'Install the thing' } })
    .returning({ id: steps.id })
  stepId = st.id
  const [run] = await db
    .insert(runs)
    .values({ userId: h.userId, templateId, versionId: ver.id, version: 1, status: 'active' })
    .returning({ id: runs.id })
  runId = run.id
  await db.insert(runStepState).values({ runId, stepId, status: 'blocked', note: 'пакет не ставится' })
})

describe('отчёт о вставшем шаге', () => {
  it('⚠️ владелец списка УЗНАЁТ о заведённой задаче', async () => {
    const where = await report()
    expect(where, 'успех ведёт на страницу новой задачи').toContain('/rb-owner/blocked-list/issues/')

    const [iss] = await db.select({ title: issues.title }).from(issues).where(eq(issues.templateId, templateId))
    expect(iss.title, 'задача называет номер шага').toContain('step 3')

    const inbox = await db.select({ type: notifications.type }).from(notifications).where(eq(notifications.recipientId, ownerId))
    expect(inbox.map((n) => n.type), 'без этого петля обратной связи обрывается на полпути').toContain('issue_new')
  })

  it('⚠️ раздел «Вопросы» выключен — отказ словами, и задачи не появляется', async () => {
    await db.update(templates).set({ issuesEnabled: false }).where(eq(templates.id, templateId))
    expect(await report(), 'человеку надо сказать, почему не вышло').toBe('noissue')
    expect(await db.select().from(issues), 'в выключенный раздел не пишем').toEqual([])
  })
})
