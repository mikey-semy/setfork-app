import { eq, sql } from 'drizzle-orm'
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

const { db, users, templates, jobs } = await import('@/shared/db')
const { sweepFailedMirrors, ensureMirrorSweepScheduled, runMirrorJob } = await import(
  '@/features/library/mirror-jobs'
)
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
  await db.execute(sql`truncate table ${users}, ${templates}, ${jobs} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'mirror-owner' }).returning({ id: users.id })
  ownerId = u.id
})

const mirrorJobs = async () => await db.select().from(jobs).where(eq(jobs.type, 'mirror'))

/**
 * Цепочка держится на том, что задача перед завершением ставит следующую. Пока
 * это была голая вставка, дубли получались двумя способами — и каждый НАВСЕГДА
 * удваивал частоту проходов, а значит и частоту пушей в чужую форджу.
 */
describe('цепочка подметальщика — ровно одна', () => {
  it('повторный старт не заводит вторую цепочку', async () => {
    await ensureMirrorSweepScheduled()
    await ensureMirrorSweepScheduled()
    expect(await mirrorJobs()).toHaveLength(1)
  })

  it('второй инстанс не получает локу, пока первый держит', async () => {
    // Случай выкатки: два процесса поднимаются вместе и оба видят «пусто».
    // Просто дёрнуть ensure дважды одновременно НЕДОСТАТОЧНО — транзакции
    // короткие и на практике не пересекаются, тест был бы зелёным и без локи
    // (проверено). Поэтому держим локу заведомо дольше и смотрим, что второй
    // получает отказ, а не «пусто, заводи ещё одну цепочку».
    const key = 0x5f_00_01
    let secondGotLock: boolean | undefined
    await db.transaction(async (holder) => {
      await holder.execute(sql`select pg_advisory_xact_lock(${key})`)
      await db.transaction(async (other) => {
        const r = await other.execute(sql`select pg_try_advisory_xact_lock(${key}) as locked`)
        secondGotLock = (r as { rows?: { locked?: boolean }[] }).rows?.[0]?.locked
      })
    })
    expect(secondGotLock).toBe(false)
  })

  it('уже идущий проход считается за цепочку (не только pending)', async () => {
    await db.insert(jobs).values({ type: 'mirror', payload: {}, status: 'processing', runAt: new Date() })
    await ensureMirrorSweepScheduled()
    expect(await mirrorJobs()).toHaveLength(1)
  })

  it('проход ставит преемника, не считая преемником себя', async () => {
    const [self] = await db
      .insert(jobs)
      .values({ type: 'mirror', payload: {}, status: 'processing', runAt: new Date() })
      .returning({ id: jobs.id })
    await runMirrorJob({}, { id: self.id, type: 'mirror', payload: {}, attempts: 1, maxAttempts: 5 })
    const rows = await mirrorJobs()
    expect(rows).toHaveLength(2) // сам проход + преемник
    expect(rows.some((r) => r.id !== self.id && r.status === 'pending')).toBe(true)
  })

  it('повторное исполнение той же задачи не плодит преемников', async () => {
    // Воркер умер после вставки преемника, жнец вернул задачу в pending, она
    // исполняется снова — второй преемник появиться не должен.
    const [self] = await db
      .insert(jobs)
      .values({ type: 'mirror', payload: {}, status: 'processing', runAt: new Date() })
      .returning({ id: jobs.id })
    const job = { id: self.id, type: 'mirror' as const, payload: {}, attempts: 1, maxAttempts: 5 }
    await runMirrorJob({}, job)
    await runMirrorJob({}, job)
    expect(await mirrorJobs()).toHaveLength(2)
  })
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
