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

/** Проба должна отвечать быстро: зависшая БД не должна превращаться в зависший монитор. */
const TIMEOUT_MS = 2000

export async function GET() {
  const started = Date.now()
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`нет ответа за ${TIMEOUT_MS} мс`)), TIMEOUT_MS)),
    ])
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
