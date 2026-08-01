import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Отбор зеркал на повтор — на НАСТОЯЩЕЙ Postgres.
 *
 * Это единственное место, где сходятся две записи одной лестницы пауз: формула в
 * `mirror-policy` (её показывает владельцу интерфейс) и её же перевод на SQL
 * внутри подметальщика. Пока они совпадают, настройки обещают то время, когда
 * повтор реально придёт; разъедутся — начнут врать, а поймать это без живой базы
 * нельзя: `make_interval`, `power` и `least` считает Postgres, а не JS.
 *
 * Отдельно проверяется то, из-за чего отбор вообще переехал в запрос: пачка
 * ограничена, и недозревшие зеркала не имеют права её занимать.
 */

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }))
// Толкать настоящий пуш здесь незачем: проверяется ОТБОР. Ядро в тестовой среде
// недоступно, а без мока проход ушёл бы в сеть.
const pushed: string[] = []
vi.mock('@/features/library/actions', () => ({
  pushListMirror: async (handle: string, slug: string) => {
    pushed.push(`${handle}/${slug}`)
    return { ok: true, error: '' }
  },
}))

const { db, users, templates } = await import('@/shared/db')
const { sweepFailedMirrors } = await import('@/features/library/mirror-jobs')
const { mirrorRetryDueAt } = await import('@/features/library/mirror-policy')

const MIN = 60_000
let ownerId = ''

/** Зеркало с ошибкой: столько-то неудач подряд, последняя попытка столько-то минут назад. */
async function failingMirror(slug: string, attempts: number, minutesAgo: number): Promise<void> {
  await db.insert(templates).values({
    ownerId,
    slug,
    title: { en: slug },
    mirrorUrl: `https://github.com/u/${slug}`,
    mirrorToken: 'enc',
    mirrorError: 'boom',
    mirrorAttempts: attempts,
    mirrorSyncedAt: new Date(Date.now() - minutesAgo * MIN),
  })
}

beforeEach(async () => {
  pushed.length = 0
  await db.execute(sql`truncate table ${users}, ${templates} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'mirror-owner' }).returning({ id: users.id })
  ownerId = u.id
})

describe('отбор зеркал на повтор', () => {
  it('берёт вылежавшееся и не трогает свежее', async () => {
    await failingMirror('ready', 1, 30) // пауза после 1 неудачи — 10 минут
    await failingMirror('fresh', 1, 2)
    await sweepFailedMirrors()
    expect(pushed).toEqual(['mirror-owner/ready'])
  })

  it('чем больше неудач, тем дольше ждём — при одинаковом времени последней попытки', async () => {
    await failingMirror('few-fails', 1, 30)
    await failingMirror('many-fails', 5, 30) // пауза после 5 неудач — 160 минут
    await sweepFailedMirrors()
    expect(pushed).toEqual(['mirror-owner/few-fails'])
  })

  it('SQL и формула интерфейса дают одну границу', async () => {
    // Ровно тот стык, ради которого тест ходит в базу. Берём момент чуть ПОСЛЕ
    // обещанного интерфейсом времени и чуть ДО — поведение обязано совпасть с
    // обещанием, а не быть на минуту раньше или позже.
    const attempts = 3
    const delayMin = (mirrorRetryDueAt(attempts, new Date(0)).getTime() - 0) / MIN
    await failingMirror('just-after', attempts, delayMin + 1)
    await failingMirror('just-before', attempts, delayMin - 1)
    await sweepFailedMirrors()
    expect(pushed).toEqual(['mirror-owner/just-after'])
  })

  it('зеркало, которое не пробовали ни разу, берётся сразу', async () => {
    await db.insert(templates).values({
      ownerId,
      slug: 'never',
      title: { en: 'never' },
      mirrorUrl: 'https://github.com/u/never',
      mirrorToken: 'enc',
      mirrorError: 'boom',
      mirrorAttempts: 0,
      mirrorSyncedAt: null,
    })
    await sweepFailedMirrors()
    expect(pushed).toEqual(['mirror-owner/never'])
  })

  it('исправное зеркало не трогаем', async () => {
    await db.insert(templates).values({
      ownerId,
      slug: 'ok',
      title: { en: 'ok' },
      mirrorUrl: 'https://github.com/u/ok',
      mirrorToken: 'enc',
      mirrorError: null,
      mirrorAttempts: 0,
      mirrorSyncedAt: new Date(Date.now() - 600 * MIN),
    })
    await sweepFailedMirrors()
    expect(pushed).toEqual([])
  })

  it('недозревшие НЕ занимают пачку: готовое чинится при любом их числе', async () => {
    // То, что нашло авто-ревью. Пока отбор шёл после `limit`, полсотни давно
    // упавших и ждущих суточной паузы вытесняли одно готовое — и проход
    // возвращался, не починив ничего, каждый раз.
    const many = Number(process.env.SETFORK_MIRROR_SWEEP_BATCH ?? 50)
    for (let i = 0; i < many + 5; i++) await failingMirror(`stale-${i}`, 9, 100)
    await failingMirror('ready', 1, 30)
    await sweepFailedMirrors()
    expect(pushed).toContain('mirror-owner/ready')
  })
})
