import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * КОНТРАКТ ПЕТЛИ. Петля считается «закрытой», если у неё есть всё, без чего она либо не
 * работает, либо работает бесконтрольно:
 *
 *   1. обработчик задачи — иначе очередь не знает, что с ней делать;
 *   2. планировщик самозапуска — иначе первая задача не встанет никогда и петля будет молчать
 *      БЕЗ единой ошибки в логах (ровно так уехал `feedpull`);
 *   3. место в перечне автономных петель — иначе её нельзя ни поставить на паузу, ни прогнать
 *      всухую: рубильник и сухой прогон работают по этому перечню;
 *   4. рубильник, который РЕАЛЬНО останавливает выдачу её задач воркеру.
 *
 * Первые три — статика (реестр против проводки), четвёртая проверяется на живой БД: ставим
 * задачу, жмём паузу, убеждаемся, что claimJob её не отдаёт.
 */
const { AUTONOMOUS_LOOPS, pauseLoop, resumeLoop } = await import('@/shared/agents/policy')
const { LOOPS } = await import('@/shared/agents/loops')
const { LOOP_WIRING } = await import('@/instrumentation-loops')
const { db, jobs, agentLoops, users } = await import('@/shared/db')
const { claimJob, enqueueJob } = await import('@/shared/jobs/queue')

beforeEach(async () => {
  await db.delete(jobs)
  await db.delete(agentLoops)
})

describe('реестр петель против перечня автономных', () => {
  it('каждая автономная петля есть в реестре и наоборот', () => {
    expect(LOOPS.map((l) => l.name).sort()).toEqual([...AUTONOMOUS_LOOPS].sort())
  })

  it('у каждой петли есть проводка: обработчик и планировщик', () => {
    for (const l of LOOPS) {
      const w = LOOP_WIRING[l.name]
      expect(w, `нет проводки для петли ${l.name}`).toBeDefined()
      expect(typeof w.handler).toBe('function')
      expect(typeof w.schedule).toBe('function')
    }
  })

  it('лишней проводки без петли в реестре нет', () => {
    expect(Object.keys(LOOP_WIRING).sort()).toEqual(LOOPS.map((l) => l.name).sort())
  })

  it('обработчик реально экспортируется модулем (не опечатка в имени)', async () => {
    for (const l of LOOPS) {
      const fn = await LOOP_WIRING[l.name].handler()
      expect(typeof fn, `обработчик ${l.handler} петли ${l.name}`).toBe('function')
    }
  })
})

describe('планировщик ставит первую задачу', () => {
  it('каждая петля после самозапуска имеет задачу в очереди', async () => {
    for (const l of LOOPS) {
      await LOOP_WIRING[l.name].schedule()
      const [row] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.type, l.jobType)).limit(1)
      expect(row, `петля ${l.name} не поставила себе задачу — молчала бы без ошибок`).toBeDefined()
    }
  })

  it('повторный самозапуск дубля не создаёт', async () => {
    await LOOP_WIRING.gardener.schedule()
    await LOOP_WIRING.gardener.schedule()
    const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.type, 'gardener'))
    expect(rows).toHaveLength(1)
  })
})

describe('рубильник останавливает выдачу задач', () => {
  it('на паузе воркер задачу петли не получает, после снятия — получает', async () => {
    const [admin] = await db
      .insert(users)
      .values({ handle: `loops-admin-${Date.now()}` })
      .returning({ id: users.id })

    for (const l of LOOPS) {
      await db.delete(jobs)
      await enqueueJob(l.jobType, {}, { maxAttempts: 1 })

      await pauseLoop(l.name, admin.id, 'контрактный тест')
      expect(await claimJob(), `петля ${l.name} выдаёт задачи на паузе`).toBeNull()

      await resumeLoop(l.name)
      const claimed = await claimJob()
      expect(claimed?.type, `петля ${l.name} не ожила после снятия паузы`).toBe(l.jobType)
    }
  })
})
