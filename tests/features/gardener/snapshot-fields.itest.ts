import { asc, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import { resetTables } from '../../helpers/reset-db'

// Снимок списка, который петля ухода отдаёт модели, обязан нести ВСЕ поля, которые нельзя
// потерять. Проверяем на реальной БД именно чтение шагов: пометка «здесь нужен человек»
// хранится в колонке, и если чтение её не берёт, refine возвращает список без неё — то есть
// каждый проход ухода стирает честные пометки. Тихо: типы такого не видят.

let ownerId = ''
let versionId = ''

beforeAll(async () => {
  await resetTables(sql`${steps}, ${templateVersions}, ${templates}, ${users}`)
  const [u] = await db.insert(users).values({ handle: 'snap-owner' }).returning({ id: users.id })
  ownerId = u.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'bread', title: { ru: 'Хлеб' }, tags: ['еда'], currentVersion: 1 })
    .returning({ id: templates.id })
  const [ver] = await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'seed' }).returning({ id: templateVersions.id })
  versionId = ver.id
  await db.insert(steps).values([
    {
      versionId,
      n: 1,
      title: { ru: 'Купить муку' },
      desc: {},
      command: '',
      level: 'required',
      why: { ru: 'без муки никак' },
      section: { ru: 'Подготовка' },
      subtasks: [],
      refs: [],
      needsHuman: true,
      needsHumanAsk: { ru: 'Сколько стоит у вас?' },
    },
    { versionId, n: 2, title: { ru: 'Замесить' }, desc: {}, command: '', level: 'required', why: {}, section: {}, subtasks: [], refs: [] },
  ])
})

describe('чтение шагов для снимка', () => {
  it('пометка и вопрос читаются из колонок — иначе refine их не увидит', async () => {
    const rows = await db.select().from(steps).where(eq(steps.versionId, versionId)).orderBy(asc(steps.n))
    expect(rows[0]).toMatchObject({ needsHuman: true })
    expect(rows[0].needsHumanAsk).toMatchObject({ ru: 'Сколько стоит у вас?' })
    expect(rows[1]).toMatchObject({ needsHuman: false })
  })

  it('снимок, собранный как в петле ухода, несёт пометку', async () => {
    const rows = await db.select().from(steps).where(eq(steps.versionId, versionId)).orderBy(asc(steps.n))
    const loc = (v: unknown) => Object.values((v ?? {}) as Record<string, string>).find(Boolean) ?? ''
    // Та же форма, что уходит в generateListRefine (см. features/gardener/service.ts).
    const snapshot = rows.map((s) => ({
      title: loc(s.title),
      desc: loc(s.desc),
      command: s.command,
      section: loc(s.section),
      level: s.level,
      why: loc(s.why),
      subtasks: [],
      refs: [],
      needsHuman: s.needsHuman,
      needsHumanAsk: loc(s.needsHumanAsk),
    }))
    expect(snapshot[0]).toMatchObject({ needsHuman: true, needsHumanAsk: 'Сколько стоит у вас?' })
    // И в сериализованном виде — именно так модель видит список.
    expect(JSON.stringify(snapshot)).toContain('needsHumanAsk')
  })
})
