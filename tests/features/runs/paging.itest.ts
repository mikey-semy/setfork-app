import { beforeEach, describe, expect, it } from 'vitest'
import { pageWindow } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПРОГОНЫ — Фаза 2: вкладка по статусу + страницы внутри вкладки.
 *
 * Раньше страница показывала три раздела сразу и делила ПОЛНУЮ выдачу в памяти, то есть
 * поднимала все прогоны человека. Со страницами такое деление невозможно в принципе:
 * страница могла бы состоять из одних завершённых, и раздел «в процессе» выглядел бы
 * пустым при живых прогонах. Поэтому статус ушёл В ЗАПРОС.
 *
 * Проверяется главное следствие: отбор и счётчик вкладки считают одно и то же, а окно
 * режется базой, а не разметкой.
 */

const { db, runs, steps, templates, templateVersions, users } = await import('@/shared/db')
const { countUserRunsByStatus, getUserRuns } = await import('@/features/runs/queries')

const ACTIVE = 7
const DONE = 4
const ABANDONED = 2
const PER = 3
let userId = ''

beforeEach(async () => {
  await resetTables([runs, steps, templateVersions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'runner' }).returning({ id: users.id })
  userId = u.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'run-list', title: { ru: 'п' } })
    .returning({ id: templates.id })
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: tpl.id, version: 1, authorId: u.id })
    .returning({ id: templateVersions.id })

  const mk = (status: 'active' | 'done' | 'abandoned', n: number, base: number) =>
    Array.from({ length: n }, (_, i) => ({
      userId,
      templateId: tpl.id,
      versionId: ver.id,
      version: 1,
      status,
      updatedAt: new Date(Date.UTC(2026, 7, 18, 12, 0, base + i)),
    }))
  await db.insert(runs).values([...mk('active', ACTIVE, 0), ...mk('done', DONE, 20), ...mk('abandoned', ABANDONED, 40)])
})

const walk = async (status: 'active' | 'done' | 'abandoned', total: number): Promise<string[]> => {
  const seen: string[] = []
  for (let p = 1; p <= Math.max(1, Math.ceil(total / PER)); p++) {
    seen.push(...(await getUserRuns(userId, status, pageWindow(p, PER))).map((r) => r.id))
  }
  return seen
}

describe('прогоны листаются вкладками и страницами', () => {
  it('счётчики вкладок совпадают с тем, что отдаёт выдача', async () => {
    const counts = await countUserRunsByStatus(userId)
    expect(counts).toEqual({ active: ACTIVE, done: DONE, abandoned: ABANDONED })
    for (const [status, n] of Object.entries(counts) as ['active' | 'done' | 'abandoned', number][]) {
      const seen = await walk(status, n)
      expect(seen, status).toHaveLength(n)
      expect(new Set(seen).size, status).toBe(n)
    }
  })

  it('вкладка отдаёт ТОЛЬКО свой статус', async () => {
    // Отбор в запросе, а не в разметке: иначе страница «в процессе» могла бы состоять
    // из завершённых просто потому, что они оказались в её окне.
    const rows = await getUserRuns(userId, 'done', pageWindow(1, DONE))
    expect(rows).toHaveLength(DONE)
    expect(rows.every((r) => r.status === 'done')).toBe(true)
  })

  it('окно режется в ЗАПРОСЕ: страница отдаёт ровно свой размер', async () => {
    expect(await getUserRuns(userId, 'active', pageWindow(1, PER))).toHaveLength(PER)
    expect(await getUserRuns(userId, 'active', pageWindow(3, PER))).toHaveLength(ACTIVE - PER * 2)
  })

  it('свежие сверху', async () => {
    const rows = await getUserRuns(userId, 'active', pageWindow(1, ACTIVE))
    const times = rows.map((r) => new Date(r.updatedAt).getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('порядок однозначен там, где время СОВПАДАЕТ', async () => {
    // Прогоны, тронутые одной операцией, имеют одинаковый updatedAt. На равных ключах
    // порядок задаёт только доопределение до id — и проверять надо САМ порядок:
    // уникальность сходится и без него, база стабильно отдаёт heap-порядок.
    const same = new Date(Date.UTC(2026, 8, 1, 12, 0, 0))
    await db.update(runs).set({ updatedAt: same })
    const rows = await getUserRuns(userId, 'active', pageWindow(1, ACTIVE))
    const ids = rows.map((r) => r.id)
    expect(ids).toEqual([...ids].sort())
  })

  it('без статуса выдача общая — прежнее поведение сохранено', async () => {
    expect(await getUserRuns(userId)).toHaveLength(ACTIVE + DONE + ABANDONED)
  })

  it('битое окно роняет запрос, а не превращается в полный скан', async () => {
    await expect(getUserRuns(userId, 'active', { limit: 0 })).rejects.toThrow(TypeError)
  })
})
