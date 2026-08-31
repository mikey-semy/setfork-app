import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import sitemap from '@/app/sitemap'
import { db, templates, templateVersions, users } from '@/shared/db'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * Карта сайта — это ПУБЛИКАЦИЯ адресов: всё, что сюда попало, мы сами отдали
 * поисковику. Поэтому проверяется не «непустой ли список», а обратное —
 * что чужого в нём нет: черновик, приватный и не прошедший модерацию.
 *
 * Сторож проверен снятием: если в `sitemap.ts` заменить `publiclyVisible()`
 * на выборку без условий, падают ровно эти три ожидания.
 *
 * ⚠️ С решения 0018 у карты ВТОРОЕ условие — уровень проверки текущей версии (порода в
 * индекс не идёт). Поэтому списки здесь заводятся С ВЕРСИЕЙ и уровнем: без версии
 * список не индексируется, и тест проверял бы не то, что написано в его названии.
 * Отдельный сторож самого правила — tests/app/sitemap-verification.itest.ts.
 */
const OWNER = 'sm-owner'
const GHOST = 'sm-ghost' // есть аккаунт, публичных списков нет
const ctx: Record<string, string> = {}

const url = (path: string) => `${SITE_ORIGIN}${path}`

beforeEach(async () => {
  for (const handle of [OWNER, GHOST]) await db.delete(users).where(eq(users.handle, handle))
  const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  const [g] = await db.insert(users).values({ handle: GHOST, name: GHOST }).returning({ id: users.id })
  ctx.owner = o.id
  ctx.ghost = g.id

  await db.insert(templates).values([
    { ownerId: ctx.owner, slug: 'sm-public', title: { en: 'public' }, tags: ['sm-tag-public'] },
    { ownerId: ctx.owner, slug: 'sm-draft', title: { en: 'draft' }, tags: ['sm-tag-draft'], status: 'draft' },
    { ownerId: ctx.owner, slug: 'sm-private', title: { en: 'private' }, tags: ['sm-tag-private'], visibility: 'private' },
    { ownerId: ctx.owner, slug: 'sm-pending', title: { en: 'pending' }, tags: ['sm-tag-pending'], moderation: 'pending' },
    // У «призрака» список есть, но он приватный: профиль такого автора в карте не нужен.
    { ownerId: ctx.ghost, slug: 'sm-ghost-private', title: { en: 'ghost' }, visibility: 'private' },
  ])
  // ⚠️ ВЕРСИИ С УРОВНЕМ ПО УМОЛЧАНИЮ («порода») — И ЭТО ЧАСТЬ ПРОВЕРКИ.
  //
  // Здесь стоял подложенный `doc_checked`: без него ожидания падали по гейту 0018, и
  // строчка «иначе первое ожидание падало бы по постороннему поводу» звучала разумно.
  // Разумно и неверно: тест перестал проверять поведение и начал ЕГО КОМПЕНСИРОВАТЬ —
  // а вместе с тем спрятал последствие гейта от двух проходов ревью подряд. На проде
  // карта схлопнулась до пяти статических адресов, и узнали мы это curl'ом, а не отсюда.
  //
  // Теперь уровень не задаётся: список рождается «породой», как в жизни, и обязан быть
  // в карте. Вернётся гейт по уровню — этот тест упадёт первым, и это правильно.
  const rows = await db.select({ id: templates.id }).from(templates).where(eq(templates.ownerId, ctx.owner))
  for (const r of rows) {
    await db.insert(templateVersions).values({ templateId: r.id, version: 1 })
  }
})

describe('карта сайта', () => {
  it('НЕПРОВЕРЕННЫЙ список в карте — индексация не зависит от уровня', async () => {
    // ⚠️ Прямая проверка правила, отсутствие которой стоило нам живого инцидента:
    // гейт по уровню выкинул из карты всё, потому что уровни заполнены у полупроцента
    // корпуса. Проверяем ровно то, что произошло на проде: список «породы» — в карте.
    const urls = (await sitemap()).map((e) => e.url)
    const [row] = await db
      .select({ lvl: templateVersions.verificationLevel })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(eq(templates.slug, 'sm-public'))
    expect(row.lvl, 'фикстура обязана быть «породой», иначе проверка ничего не значит').toBe('rock')
    expect(urls).toContain(url(`/${OWNER}/sm-public`))
  })

  it('карта не пустеет: списки, профили и теги на месте', async () => {
    // Канарейка против повторения инцидента: считаем не конкретные адреса, а то, что
    // каждая из трёх групп вообще присутствует. Схлопывание карты до статических
    // страниц — это ровно «все три группы исчезли разом».
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls.some((u) => u.includes(`/${OWNER}/sm-public`)), 'ни одного списка').toBe(true)
    expect(urls.some((u) => u.endsWith(`/${OWNER}`)), 'ни одного профиля').toBe(true)
    expect(urls.some((u) => u.includes('/tags/')), 'ни одного тега').toBe(true)
  })

  it('публичный список попадает, черновик/приватный/на модерации — нет', async () => {
    const urls = (await sitemap()).map((e) => e.url)

    expect(urls).toContain(url(`/${OWNER}/sm-public`))
    expect(urls).not.toContain(url(`/${OWNER}/sm-draft`))
    expect(urls).not.toContain(url(`/${OWNER}/sm-private`))
    expect(urls).not.toContain(url(`/${OWNER}/sm-pending`))
  })

  it('тег виден только по видимым спискам — иначе страница тега в индексе пуста', async () => {
    const urls = (await sitemap()).map((e) => e.url)

    expect(urls).toContain(url('/tags/sm-tag-public'))
    for (const hidden of ['sm-tag-draft', 'sm-tag-private', 'sm-tag-pending']) {
      expect(urls).not.toContain(url(`/tags/${hidden}`))
    }
  })

  it('профиль попадает только у автора с публичными списками', async () => {
    const urls = (await sitemap()).map((e) => e.url)

    expect(urls).toContain(url(`/${OWNER}`))
    expect(urls).not.toContain(url(`/${GHOST}`))
  })

  it('у списка проставлена дата правки — по ней обходчик решает, перечитывать ли', async () => {
    const entry = (await sitemap()).find((e) => e.url === url(`/${OWNER}/sm-public`))

    expect(entry?.lastModified).toBeInstanceOf(Date)
  })

  it('статические разделы на месте и без дублей', async () => {
    const urls = (await sitemap()).map((e) => e.url)

    for (const path of ['/', '/explore', '/trending', '/tags', '/collections']) {
      expect(urls).toContain(url(path))
    }
    expect(new Set(urls).size).toBe(urls.length)
  })
})
