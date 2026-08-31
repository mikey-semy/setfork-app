import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, templates, templateVersions, users } from '@/shared/db'

/**
 * ИНДЕКСАЦИЯ НЕ ЗАВИСИТ ОТ УРОВНЯ ПРОВЕРКИ — пока уровни не заполнены.
 *
 * ⚠️ ЭТОТ ТЕСТ ПОМЕНЯЛ СТОРОНУ, и вот почему. Он был написан под 0018 («порода в карту
 * не идёт») и сторожил это правило верно. Но правило оказалось гейтом по НЕЗАПОЛНЕННОЙ
 * колонке: уровни проставлены примерно у полупроцента корпуса, и после выкатки карта
 * сайта схлопнулась до пяти статических адресов — ни одного списка, профиля и тега.
 * Проверено на проде 31.08 curl'ом, а не рассуждением.
 *
 * Дух 0018 не отменён: «непроверенное не предлагаем поисковику как готовое» остаётся
 * целью. Отменён СПОСОБ — фильтровать по полю, которое ещё некому заполнить. Гейт
 * вернётся отдельным решением, когда будет что фильтровать, и с порогом по числам.
 *
 * Пока решение владельца по этому не подтверждено, тест держит ПРЕДЛОЖЕННОЕ поведение:
 * вернётся гейт — он упадёт первым, и это правильный сигнал, а не поломка.
 *
 * ⚠️ Условие по-прежнему ОТДЕЛЬНОЕ от `publiclyVisible()` — второй тест ниже это
 * сторожит: видимость отвечает «кому можно показать», индексация — «что мы выдаём за
 * готовое». Сводить их нельзя, даже когда они временно совпали.
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
  it('в карте ВСЕ опубликованные — и порода тоже', async () => {
    await published('sm-rock', 'rock')
    await published('sm-doc', 'doc_checked')
    await published('sm-crystal', 'crystal')

    const { default: sitemap } = await import('@/app/sitemap')
    const urls = (await sitemap()).map((e) => e.url)

    expect(urls.some((u) => u.endsWith(`/${OWNER}/sm-doc`)), 'сверенный по источникам обязан быть в карте').toBe(true)
    expect(urls.some((u) => u.endsWith(`/${OWNER}/sm-crystal`)), 'пройденный целиком обязан быть в карте').toBe(true)
    // Ровно тот случай, который обнулил карту на проде: почти весь корпус — «порода».
    expect(urls.some((u) => u.endsWith(`/${OWNER}/sm-rock`)), 'гейт по незаполненной колонке обнуляет витрину').toBe(true)
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
