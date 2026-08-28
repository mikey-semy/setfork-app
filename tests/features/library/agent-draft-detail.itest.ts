import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { canViewList } from '@/core/domain/access'
import { getTemplateDetail } from '@/features/library/queries/list'
import { db, templates, templateVersions, users } from '@/shared/db'

/**
 * ЧЕРНОВИК ГНОМА ВИДЕН МОДЕРАТОРУ НА САМОЙ СТРАНИЦЕ СПИСКА.
 *
 * Правило видимости уже умеет пропускать администратора к черновику служебного
 * аккаунта — это проверено юнит-тестами на самом правиле. Но правило читает признак
 * У ОБЪЕКТА СПИСКА, а объект собирает запрос: getListMeta признак отдавал, а
 * getTemplateDetail — нет, и страница списка, экспорт и /data.json ходят через
 * второй. То есть статью гнома по-прежнему нельзя было открыть — ровно жалоба
 * владельца, только уровнем ниже, чем я её тогда закрыл.
 *
 * Поэтому проверяется не правило, а СВЯЗКА: что запрос донёс признак до правила.
 */
const GNOME = 'ad-gnome'
const HUMAN = 'ad-human'
const admin = { isOwner: false, isAdmin: true }

async function makeDraft(handle: string, accountType: 'agent' | 'user', slug: string) {
  await db.delete(users).where(eq(users.handle, handle))
  const [u] = await db
    .insert(users)
    .values({ handle, name: handle, accountType })
    .returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug, title: { en: slug }, currentVersion: 1, status: 'draft' })
    .returning({ id: templates.id })
  await db.insert(templateVersions).values({ templateId: t.id, version: 1 })
  return handle
}

beforeEach(async () => {
  for (const h of [GNOME, HUMAN]) await db.delete(users).where(eq(users.handle, h))
})

describe('деталь списка доносит до правила, что владелец — служебный аккаунт', () => {
  it('черновик гнома модератор открывает', async () => {
    await makeDraft(GNOME, 'agent', 'gnome-draft')
    const detail = await getTemplateDetail(GNOME, 'gnome-draft')
    expect(detail, 'черновик не нашёлся — тест проверял бы пустоту').not.toBeNull()
    expect(detail!.tpl.ownerIsAgent).toBe(true)
    expect(canViewList(detail!.tpl, admin)).toBe(true)
  })

  it('черновик человека — нет, и это разные случаи', async () => {
    await makeDraft(HUMAN, 'user', 'human-draft')
    const detail = await getTemplateDetail(HUMAN, 'human-draft')
    expect(detail!.tpl.ownerIsAgent).toBe(false)
    expect(canViewList(detail!.tpl, admin)).toBe(false)
  })
})
