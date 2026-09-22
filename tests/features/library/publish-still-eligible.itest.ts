import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * СОСТОЯНИЕ СПИСКА ПРОВЕРЯЕТСЯ В МОМЕНТ ЗАПИСИ, А НЕ В МОМЕНТ РЕШЕНИЯ.
 *
 * Автономная петля решает «публиковать», а потом ещё МИНУТЫ занята: вызов модели, три
 * линзы готовности, проверка ссылок. За это время админ успевает снять список
 * модерацией или заархивировать его. Безусловный `update … where id` публиковал вопреки
 * этому, а журнал петли писал `list.publish` успехом.
 *
 * ⚠️ Владелец здесь НЕ проверяется, и это осознанно. `publishOwnedDrafts` отсеивает по
 * `ownerId === userId`, а садовник действует от `tenderId` — смотрителя или себя самого,
 * — и владельцем списка быть не обязан. Потребовать владельца значило бы молча
 * остановить автопубликацию вовсе: петля продолжала бы работать и ничего не публиковать.
 * Поэтому повторены ровно те условия, которые говорят о СОСТОЯНИИ списка.
 *
 * Тест на КЛАСС: перечень состояний, каждое из которых обязано отменить запись, плюс
 * обратная сторона — обычный черновик обязан публиковаться.
 */

const { db, users, templates } = await import('@/shared/db')
const { publishIfStillEligible } = await import('@/features/library/publish-draft')

let ownerId = ''

beforeEach(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'gardener-owner' }).returning({ id: users.id })
  ownerId = u.id
})

/** Список в заданном состоянии — то, каким его застанет запись. */
async function list(over: Partial<typeof templates.$inferInsert> = {}) {
  const [row] = await db
    .insert(templates)
    .values({
      ownerId,
      slug: `l-${Math.random().toString(36).slice(2, 8)}`,
      title: { ru: 'Список', en: 'List' },
      status: 'draft',
      visibility: 'public',
      ...over,
    })
    .returning({ id: templates.id })
  return row.id
}

const statusOf = async (id: string) =>
  (await db.select({ status: templates.status }).from(templates).where(eq(templates.id, id)))[0]?.status

describe('публикация петлёй сверяет состояние в самом запросе', () => {
  // ⚠️ ОБРАТНАЯ СТОРОНА ПЕРВОЙ. Ошибка здесь тише дефекта: петля продолжит работать и
  // просто перестанет публиковать — заметить это можно только по отсутствию новых
  // списков, то есть через дни.
  it('обычный черновик публикуется', async () => {
    const id = await list()

    await expect(publishIfStillEligible(id)).resolves.toBe(true)
    expect(await statusOf(id)).toBe('published')
  })

  it.each([
    ['заархивирован, пока шла проверка', { archivedAt: new Date() }],
    ['заморожен, пока шла проверка', { frozenAt: new Date() }],
    ['снят модерацией: flagged', { moderation: 'flagged' as const }],
    ['скрыт модерацией: hidden', { moderation: 'hidden' as const }],
    ['уже не черновик', { status: 'published' as const }],
  ])('состояние отменяет запись: %s', async (_name, over) => {
    const id = await list(over)
    const before = await statusOf(id)

    await expect(
      publishIfStillEligible(id),
      'запись сообщила об успехе, которого не было',
    ).resolves.toBe(false)
    expect(await statusOf(id), 'состояние списка изменено вопреки решению администратора').toBe(before)
  })

  it('решение принимается по ЧИСЛУ затронутых строк, а не по прочитанному раньше', async () => {
    const id = await list()
    // Имитируем то самое окно: решение уже принято, а список за это время сняли.
    await db.update(templates).set({ moderation: 'hidden' }).where(eq(templates.id, id))

    await expect(publishIfStillEligible(id)).resolves.toBe(false)
    expect(await statusOf(id)).toBe('draft')
  })
})
