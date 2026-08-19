import { beforeEach, describe, expect, it } from 'vitest'
import { pageWindow } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * РЕЛИЗЫ — Фаза 2: номера страниц. Каталог, а не лента: по релизам прыгают («что было
 * в 1.2»), и растут они монотонно — раньше выдача шла без предела вовсе.
 *
 * Отдельно проверяется МЕТКА «последний». Она ставилась первому не-пред-релизу в ПОЛНОЙ
 * выдаче; со страницами так нельзя — попадись на первой странице одни пред-релизы, метка
 * уехала бы на вторую и встала не на тот релиз. Это тот же класс, что участники треда и
 * авторы истории: величина, посчитанная по всей выдаче, при переводе на порции врёт.
 */

const { db, releases, templates, users } = await import('@/shared/db')
const { countReleases, getLatestReleaseId, getReleases } = await import('@/features/releases/queries')

const COUNT = 7
const PER = 3
let templateId = ''

beforeEach(async () => {
  await resetTables([releases, templates, users])
  const [u] = await db.insert(users).values({ handle: 'rel-author' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'rel-list', title: { ru: 'р' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  await db
    .insert(releases)
    .values(
      Array.from({ length: COUNT }, (_, i) => ({
        templateId,
        authorId: u.id,
        version: i + 1,
        tag: `v${i + 1}`,
        title: `релиз ${i + 1}`,
        // Четыре САМЫХ СВЕЖИХ — пред-релизы, то есть настоящий «последний» лежит на
        // ВТОРОЙ странице при размере три.
        prerelease: i + 1 > COUNT - 4,
        // Разное время: порядок задаёт оно, как в жизни. Доопределение проверяется
        // отдельным тестом ниже — на строках с СОВПАДАЮЩИМ временем.
        createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, i)),
      })),
    )
})

const walk = async (total: number): Promise<string[]> => {
  const seen: string[] = []
  for (let p = 1; p <= Math.ceil(total / PER); p++) {
    seen.push(...(await getReleases(templateId, pageWindow(p, PER))).map((r) => r.id))
  }
  return seen
}

describe('релизы листаются страницами', () => {
  it('счёт и выдача сходятся, строки не повторяются', async () => {
    const total = await countReleases(templateId)
    expect(total).toBe(COUNT)
    const seen = await walk(total)
    expect(seen).toHaveLength(COUNT)
    expect(new Set(seen).size).toBe(COUNT)
  })

  it('свежие сверху', async () => {
    const all = await getReleases(templateId)
    expect(all.map((r) => r.version)).toEqual([7, 6, 5, 4, 3, 2, 1])
  })

  it('порядок однозначен и там, где время СОВПАДАЕТ', async () => {
    // Три релиза одним мгновением — так бывает при импорте и массовой операции. На
    // равных ключах порядок задаёт только доопределение до id, и проверять надо САМ
    // порядок: уникальность сходится и без него, потому что база стабильно отдаёт
    // heap-порядок.
    const [u] = await db.select({ id: users.id }).from(users).limit(1)
    const same = new Date(Date.UTC(2026, 7, 19, 12, 0, 0))
    const added = await db
      .insert(releases)
      .values(
        [8, 9, 10].map((v) => ({
          templateId,
          authorId: u.id,
          version: v,
          tag: `v${v}`,
          title: `релиз ${v}`,
          createdAt: same,
        })),
      )
      .returning({ id: releases.id })

    // Они самые свежие, значит идут первыми — и между собой обязаны стоять по id.
    const top = (await getReleases(templateId, pageWindow(1, 3))).map((r) => r.id)
    expect(new Set(top)).toEqual(new Set(added.map((r) => r.id)))
    expect(top).toEqual([...top].sort())
  })

  it('«последний» релиз НЕ зависит от того, какую страницу открыли', async () => {
    // Настоящий последний — самый свежий не-пред-релиз, а он тут на второй странице.
    const latest = await getLatestReleaseId(templateId)
    const firstPage = await getReleases(templateId, pageWindow(1, PER))
    expect(firstPage.every((r) => r.prerelease)).toBe(true)
    expect(firstPage.map((r) => r.id)).not.toContain(latest)
    // Именно эта строка и есть искомая: старый способ (первый не-пред-релиз показанной
    // страницы) на первой странице не нашёл бы ничего, а на второй пометил бы не тот.
    expect(latest).not.toBeNull()
    const all = await getReleases(templateId)
    expect(latest).toBe(all.find((r) => !r.prerelease)!.id)
  })

  it('без окна выдача полная — сборке changelog нужны все релизы', async () => {
    expect(await getReleases(templateId)).toHaveLength(COUNT)
  })

  it('битое окно роняет запрос, а не превращается в полный скан', async () => {
    await expect(getReleases(templateId, { limit: 0 })).rejects.toThrow(TypeError)
  })
})
