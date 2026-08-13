import { sql } from 'drizzle-orm'
import { db } from '@/shared/db'

/**
 * READINESS — «готов ли обслуживать», в отличие от `/api/health` («жив ли процесс»).
 *
 * Зачем отдельная проба. `/api/health` намеренно не ходит в БД: она нужна Docker
 * HEALTHCHECK, чтобы отличить повисший процесс от живого. Но при мёртвой базе
 * получалось так (замер линзы 08, R10, на своём стенде — `docker stop` у Postgres):
 *
 *   /api/health   200 за 0.045 с   ← контейнер «healthy», остаётся в ротации Traefik
 *   /             500
 *   /explore      200 за 3.4 с     ← код 200, страница без данных
 *
 * Последнее опаснее всего: у стриминговых страниц заголовок 200 уходит РАНЬШЕ, чем
 * падает запрос к БД, поэтому http-мониторинг по коду ответа падения не увидит
 * вовсе. Внешний монитор надо вешать сюда.
 *
 * Ответ текстом и по ключевому слову — как у соседней `mod-health`: у нас уже так
 * устроены keyword-мониторы (слова PROBLEM, MOD_PENDING), и UptimeRobot умеет
 * следить именно за словом, а не только за кодом.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Потолок ожидания — на СТОРОНЕ POSTGRES (`statement_timeout`), а не гонкой
 * промисов. `Promise.race` перестаёт ждать, но сам запрос не отменяет: клиент
 * остаётся занят, и каждая следующая проба съедала бы ещё один из пула
 * (`DB_POOL_MAX` по умолчанию 20). Проба, добивающая пул во время аварии, — это
 * не мониторинг, а вторая авария. Замечание авто-ревью на fe#778.
 *
 * `set local` требует транзакции, поэтому запрос идёт в ней: по истечении срока
 * Postgres сам прерывает запрос и возвращает клиента в пул. Тот же приём уже
 * работает в `tests/helpers/reset-db.ts` (там `lock_timeout`).
 */
const TIMEOUT_MS = 2000

export async function GET() {
  const started = Date.now()
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local statement_timeout = ${TIMEOUT_MS}`))
      await tx.execute(sql`select 1`)
    })
    return text(`READY db ${Date.now() - started}ms\n`, 200)
  } catch (e) {
    // Причина в теле: «NOT_READY» без неё заставляет лезть в логи ровно тогда,
    // когда логи и недоступны.
    const why = e instanceof Error ? e.message : String(e)
    return text(`NOT_READY db: ${why}\n`, 503)
  }
}

function text(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
