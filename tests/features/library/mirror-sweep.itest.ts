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
// `down` изображает НЕДОСТУПНОЕ ядро (до него не дошло — записывать неудачу
// некому), `delivered` — ядро, которое ОТВЕТИЛО. Разница принципиальна: во
// втором случае счётчик неудач уже сдвинуло само ядро.
let down = false
let delivered: { ok: boolean; error: string } | null = null
vi.mock('@/features/library/mirror-push', () => ({
  pushListMirror: async (handle: string, slug: string) => {
    pushed.push(`${handle}/${slug}`)
    if (!down) return { ...(delivered ?? { ok: true, error: '' }), delivered: true }
    // Настоящий `pushListMirror` при недоставленном вызове САМ записывает
    // неудачу (иначе строка не попадёт в повторы вовсе — см.
    // mirror-undelivered.itest). Мок обязан вести себя так же, иначе проверка
    // «следующий проход не берёт её снова» ничего не значит.
    const dbm = await import('@/shared/db')
    await dbm.db
      .update(dbm.templates)
      .set({
        mirrorError: 'core unavailable',
        mirrorSyncedAt: new Date(),
        mirrorAttempts: sql`${dbm.templates.mirrorAttempts} + 1`,
      })
      .where(eq(dbm.templates.slug, slug))
    return { ok: false, error: 'core unavailable', delivered: false }
  },
}))

const { db, users, templates, jobs } = await import('@/shared/db')
const { sweepFailedMirrors, ensureMirrorSweepScheduled, runMirrorJob, finalizeMirrorJob } = await import(
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
  down = false
  delivered = null
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

  it('занятая лока заставляет ЖДАТЬ, а не уходить ни с чем', async () => {
    // Случай выкатки. Просто дёрнуть ensure дважды одновременно НЕДОСТАТОЧНО:
    // транзакции короткие и на практике не пересекаются — такой тест зелен и без
    // всякой локи (проверено). Поэтому держим локу заведомо дольше.
    //
    // Проверяем именно ОЖИДАНИЕ: прежняя версия при занятой локе просто
    // возвращалась, считая, что задачу поставит держащий. А он мог не поставить,
    // увидев наш проход в processing, — и цепочка обрывалась.
    const key = 0x5f_00_01
    let finished = false
    let waiting: Promise<void> | undefined
    await db.transaction(async (holder) => {
      await holder.execute(sql`select pg_advisory_xact_lock(${key})`)
      waiting = ensureMirrorSweepScheduled().then(() => {
        finished = true
      })
      await new Promise((r) => setTimeout(r, 400))
      expect(finished).toBe(false) // ждёт локу, а не сдался
      expect(await mirrorJobs()).toHaveLength(0)
    })
    await waiting
    expect(await mirrorJobs()).toHaveLength(1) // дождался и поставил
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

  it('похороненная задача восстанавливает цепочку через финализатор', async () => {
    // Процесс умер на последней попытке, до постановки преемника не дошёл. Жнец
    // пометит строку failed — и без финализатора цепочка оборвалась бы навсегда:
    // старт увидел бы мёртвую строку как живую цепочку и ничего не поставил.
    const [dead] = await db
      .insert(jobs)
      .values({ type: 'mirror', payload: {}, status: 'failed', attempts: 5, maxAttempts: 5, runAt: new Date() })
      .returning({ id: jobs.id })
    await finalizeMirrorJob({}, { id: dead.id, type: 'mirror', payload: {}, attempts: 5, maxAttempts: 5 })
    const alive = (await mirrorJobs()).filter((r) => r.status === 'pending')
    expect(alive).toHaveLength(1)
  })

  it('финализатор идемпотентен: повтор не плодит цепочки', async () => {
    // Контракт финализаторов: повтор здесь штатный (задачу добирает следующий
    // проход, пока похороны не состоялись), поэтому второй вызов обязан молчать.
    const job = { id: crypto.randomUUID(), type: 'mirror' as const, payload: {}, attempts: 5, maxAttempts: 5 }
    await finalizeMirrorJob({}, job)
    await finalizeMirrorJob({}, job)
    expect(await mirrorJobs()).toHaveLength(1)
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

  it('ни разу не пробованное идёт ПЕРВЫМ, а не последним', async () => {
    // Postgres в `order by ... asc` кладёт NULL в конец: пока время готовности
    // было NULL, такое зеркало при длинной очереди не попадало в пачку никогда —
    // хотя из всех ждущих оно самое обделённое.
    for (let i = 0; i < 5; i++) await failingMirror(`dated-${i}`, 1, 100)
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
    expect(pushed[0]).toBe('mirror-owner/never')
  })

  it('недоступное ядро откладывает попытку и двигает счётчик', async () => {
    // Ядро лежит — записать неудачу некому, и без своей отметки строка осталась
    // бы «пора»: следующий проход брал бы её снова и снова. А без счётчика пауза
    // не росла бы — стучались бы каждые десять минут всю аварию.
    down = true
    await failingMirror('unreachable', 1, 30)
    await sweepFailedMirrors()
    expect(pushed).toEqual(['mirror-owner/unreachable'])
    const [row] = await db.select().from(templates).where(eq(templates.slug, 'unreachable'))
    expect(row.mirrorAttempts).toBe(2)
    pushed.length = 0
    await sweepFailedMirrors() // следующий проход прямо сейчас
    expect(pushed).toEqual([])
  })

  it('ответивший отказом ядро счётчик не трогаем — его ведёт оно само', async () => {
    // Иначе счёт шёл бы в две руки, и «повторяем раз в сутки» наступало бы вдвое
    // раньше обещанного.
    delivered = { ok: false, error: '403 Forbidden' }
    await failingMirror('refused', 1, 30)
    await sweepFailedMirrors()
    const [row] = await db.select().from(templates).where(eq(templates.slug, 'refused'))
    expect(row.mirrorAttempts).toBe(1)
  })

  it('при тесных настройках проход делает хотя бы одно зеркало, а не ноль', async () => {
    // Пуш и бюджет настраиваются независимо. Когда дедлайн вызова больше
    // половины порога жнеца, проверка резерва истинна ещё ДО первого кандидата —
    // и проход выходил бы пустым каждые пять минут вечно. Один пуш заведомо
    // короче порога жнеца, поэтому первый идёт всегда.
    const prev = process.env.SETFORK_MIRROR_PUSH_TIMEOUT_SEC
    process.env.SETFORK_MIRROR_PUSH_TIMEOUT_SEC = String(24 * 3600) // заведомо больше бюджета
    try {
      await failingMirror('first', 1, 40)
      await failingMirror('second', 1, 30)
      await sweepFailedMirrors()
      expect(pushed).toHaveLength(1)
    } finally {
      if (prev === undefined) delete process.env.SETFORK_MIRROR_PUSH_TIMEOUT_SEC
      else process.env.SETFORK_MIRROR_PUSH_TIMEOUT_SEC = prev
    }
  })

  it('зеркало, сломанное месяцами, не становится «всегда пора»', async () => {
    // 600 * 2^43 секунд не помещается в интервал, и Postgres МОЛЧА переполняется
    // в отрицательный: время готовности уезжало в прошлое, и самое сломанное
    // зеркало долбилось каждый проход — ровно то, от чего лестница пауз заведена.
    await failingMirror('ancient', 44, 60)
    await sweepFailedMirrors()
    expect(pushed).toEqual([])
    // А через сутки с лишним — берём: потолок паузы остаётся сутками.
    await db
      .update(templates)
      .set({ mirrorSyncedAt: new Date(Date.now() - 25 * 60 * MIN) })
      .where(eq(templates.slug, 'ancient'))
    await sweepFailedMirrors()
    expect(pushed).toEqual(['mirror-owner/ancient'])
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
