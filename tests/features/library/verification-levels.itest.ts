import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, templates, templateVersions, users } from '@/shared/db'

/**
 * УРОВЕНЬ ПРОВЕРКИ — СВОЙСТВО ВЕРСИИ, И НОВАЯ ВЕРСИЯ РОЖДАЕТСЯ «ПОРОДОЙ».
 *
 * Решение 0018: бинарное «проверено» нежизнеспособно (проверить «в деле» список про
 * развёртывание — значит реально развернуть), поэтому градация; и она относится к
 * ВЕРСИИ, а не к списку: правка сбрасывает уровень, пока автор не подтвердит заново.
 *
 * ⚠️ Сброс НЕ пишется отдельным кодом — он выходит из устройства: версии создаёт ядро, а
 * умолчание колонки — «порода». Отдельный код сброса завёл бы второе место, где
 * решается уровень, и однажды про него забыли бы. Тест проверяет именно это свойство:
 * вставка версии БЕЗ указания уровня даёт породу.
 */
const OWNER = 'vl-owner'
const ctx: Record<string, string> = {}

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  ctx.owner = u.id
})

async function list(slug: string) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: slug }, currentVersion: 1, visibility: 'public', status: 'published', moderation: 'active' })
    .returning({ id: templates.id })
  return t.id
}

describe('уровень проверки версии', () => {
  it('новая версия рождается породой — без единой строки кода сброса', async () => {
    const id = await list('vl-fresh')
    const [v] = await db.insert(templateVersions).values({ templateId: id, version: 1 }).returning({
      level: templateVersions.verificationLevel,
      at: templateVersions.verifiedAt,
    })
    expect(v.level).toBe('rock')
    expect(v.at).toBeNull()
  })

  it('уровень живёт у версии, а не у списка: соседние версии независимы', async () => {
    const id = await list('vl-two')
    await db.insert(templateVersions).values({
      templateId: id,
      version: 1,
      verificationLevel: 'crystal',
      verifiedAt: new Date('2026-08-01'),
      verifiedEnv: 'Ubuntu 24.04, Caddy 2.8',
    })
    // Правка = новая версия. Она рождается породой, и уровень первой её не касается.
    await db.insert(templateVersions).values({ templateId: id, version: 2 })
    const rows = await db
      .select({ v: templateVersions.version, level: templateVersions.verificationLevel })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id))
      .orderBy(templateVersions.version)
    expect(rows.map((r) => r.level)).toEqual(['crystal', 'rock'])
  })

  it('дата и окружение хранятся рядом с уровнем', async () => {
    // Без даты метка врёт тем сильнее, чем старше список — это записано в решении.
    const id = await list('vl-dated')
    const [v] = await db
      .insert(templateVersions)
      .values({
        templateId: id,
        version: 1,
        verificationLevel: 'cut',
        verifiedAt: new Date('2026-08-15T10:00:00Z'),
        verifiedEnv: 'macOS 15, node 22',
        verifiedBy: ctx.owner,
      })
      .returning({ at: templateVersions.verifiedAt, env: templateVersions.verifiedEnv, by: templateVersions.verifiedBy })
    expect(v.at?.toISOString()).toBe('2026-08-15T10:00:00.000Z')
    expect(v.env).toBe('macOS 15, node 22')
    expect(v.by).toBe(ctx.owner)
  })
})
