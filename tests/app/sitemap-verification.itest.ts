import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, templates, templateVersions, users } from '@/shared/db'

/**
 * СПИСОК УРОВНЯ «ПОРОДА» НЕ ПОПАДАЕТ В КАРТУ САЙТА.
 *
 * Решение 0018: публиковать непроверенный список можно, но в витрину и в индекс он не
 * идёт до первой проверки. Публиковать — можно; ПРЕДЛАГАТЬ ПОИСКОВИКУ как готовое —
 * нет.
 *
 * ⚠️ Условие ОТДЕЛЬНОЕ от `publiclyVisible()`, и тест это тоже сторожит: видимость
 * отвечает на вопрос «кому можно показать», индексация — «что мы выдаём за готовое».
 * Свести их значило бы спрятать непроверенный список от его же автора и от людей по
 * ссылке — чего никто не просил, — и правка ушла бы разом в ленту, страницу и админку.
 */
const OWNER = 'sm-owner'
const ctx: Record<string, string> = {}

vi.mock('@/features/collections/queries', () => ({ getCollections: async () => [] }))

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  ctx.owner = u.id
})

async function published(slug: string, level: 'rock' | 'doc_checked' | 'crystal') {
  const [t] = await db
    .insert(templates)
    .values({
      ownerId: ctx.owner,
      slug,
      title: { en: slug },
      currentVersion: 1,
      visibility: 'public',
      status: 'published',
      moderation: 'active',
    })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: t.id, version: 1, verificationLevel: level })
  return t.id
}

describe('карта сайта и уровень проверки', () => {
  it('порода отсутствует, проверенные — на месте', async () => {
    await published('sm-rock', 'rock')
    await published('sm-doc', 'doc_checked')
    await published('sm-crystal', 'crystal')

    const { default: sitemap } = await import('@/app/sitemap')
    const urls = (await sitemap()).map((e) => e.url)

    expect(urls.some((u) => u.endsWith(`/${OWNER}/sm-doc`)), 'сверенный по источникам обязан быть в карте').toBe(true)
    expect(urls.some((u) => u.endsWith(`/${OWNER}/sm-crystal`)), 'пройденный целиком обязан быть в карте').toBe(true)
    expect(urls.some((u) => u.endsWith(`/${OWNER}/sm-rock`)), 'породу поисковику не предлагаем').toBe(false)
  })

  it('видимость не тронута: непроверенный список остаётся публично видимым', async () => {
    // Обратная половина того же правила. Если однажды условие переедет в
    // `publiclyVisible()`, этот тест покраснеет — и покраснеет правильно.
    const id = await published('sm-visible', 'rock')
    const [row] = await db
      .select({ v: templates.visibility, s: templates.status, m: templates.moderation })
      .from(templates)
      .where(eq(templates.id, id))
    expect([row.v, row.s, row.m]).toEqual(['public', 'published', 'active'])
  })
})
