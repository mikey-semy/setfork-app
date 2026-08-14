import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, jobs } from '@/shared/db'
import { claimJob, completeJob, enqueueJob, failJob, reapStalledJobs } from '@/shared/jobs/queue'

// ПРОБНИК линзы 03 (деньги), не для коммита: платим ли дважды за один результат.
//
// Дорогая задача — 'generate' (полный совет ≈ 6.5 вызовов модели, 5.57₽ по замеру
// research/2026-07-22-unit-economics-v2). Ставится с maxAttempts: 2.
//
// Вопрос не «повторяется ли задача» (это правильно), а «проверяет ли повтор, что
// работа уже сделана, ДО того как заплатить снова».
//
// Прогон: DATABASE_URL=... npx vitest run --config vitest.integration.config.ts tests/features/money/retry-probe.itest.ts

beforeEach(async () => {
  await db.delete(jobs)
})

describe('повтор дорогой задачи', () => {
  it('после ошибки задача берётся в работу второй раз', async () => {
    await enqueueJob('generate', { generationId: 'g1', idx: 1 }, { maxAttempts: 2 })

    const first = await claimJob(['generate'])
    expect(first, 'первая попытка').toBeTruthy()
    console.log('ПОПЫТКА 1:', { attempts: first!.attempts, max: first!.maxAttempts })

    // Дорогая работа выполнена, но что-то упало после неё.
    await failJob(first!, 'упало после генерации')
    // Backoff мог отодвинуть run_at — сдвигаем время назад, чтобы не ждать.
    await db.execute(sql`update ${jobs} set run_at = now() - interval '1 hour'`)

    const second = await claimJob(['generate'])
    console.log('ПОПЫТКА 2:', second ? { attempts: second.attempts, max: second.maxAttempts } : null)
    expect(second, 'задача берётся повторно — расход пойдёт заново').toBeTruthy()
    expect(second!.attempts).toBe(2)

    await failJob(second!, 'упало снова')
    await db.execute(sql`update ${jobs} set run_at = now() - interval '1 hour'`)
    const third = await claimJob(['generate'])
    console.log('ПОПЫТКА 3:', third)
    expect(third, 'после исчерпания попыток задача больше не берётся').toBeNull()

    const [row] = await db.select({ status: jobs.status, attempts: jobs.attempts }).from(jobs)
    console.log('ИТОГ ЗАДАЧИ:', row)
    expect(row.status).toBe('failed')
  })

  it('зависшая задача возвращается в очередь и выполняется заново', async () => {
    await enqueueJob('generate', { generationId: 'g2', idx: 1 }, { maxAttempts: 2 })
    const claimed = await claimJob(['generate'])
    expect(claimed).toBeTruthy()

    // Процесс упал (деплой, OOM) — задача осталась в processing, никто её не завершил.
    await db.execute(sql`update ${jobs} set updated_at = now() - interval '2 hours' where id = ${claimed!.id}`)
    const reaped = await reapStalledJobs()
    console.log('РЕАПНУТО зависших:', reaped)
    expect(reaped).toBe(1)

    const again = await claimJob(['generate'])
    console.log('ПОСЛЕ РЕАПА взята снова:', again ? { attempts: again.attempts } : null)
    expect(again, 'зависшая дорогая задача выполняется заново — оплата повторная').toBeTruthy()
  })

  it('успешно завершённая задача повторно не берётся', async () => {
    await enqueueJob('generate', { generationId: 'g3', idx: 1 }, { maxAttempts: 2 })
    const claimed = await claimJob(['generate'])
    await completeJob(claimed!.id)
    await db.execute(sql`update ${jobs} set run_at = now() - interval '1 hour'`)
    const again = await claimJob(['generate'])
    console.log('ПОСЛЕ УСПЕХА:', again)
    expect(again, 'завершённая задача не должна браться снова').toBeNull()
  })

  it('сколько задач одного типа могут выполняться одновременно', async () => {
    for (let i = 0; i < 5; i++) await enqueueJob('generate', { generationId: `p${i}`, idx: 1 }, { maxAttempts: 2 })
    const claimed = []
    for (let i = 0; i < 5; i++) {
      const j = await claimJob(['generate'])
      if (j) claimed.push(j.id)
    }
    console.log(`ОДНОВРЕМЕННО ВЗЯТО: ${claimed.length} задач (ограничителя на тип нет — считает только SETFORK_JOB_CONCURRENCY)`)
    expect(claimed.length).toBe(5)
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(jobs.status, 'processing'))
    expect(n).toBe(5)
  })
})
