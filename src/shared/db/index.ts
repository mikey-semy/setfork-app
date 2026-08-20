// Singleton Drizzle-клиент. Один Pool на процесс. LAZY init — не падаем на
// module-load (иначе Next при "Collecting page data" без env ломает build).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

const { Pool } = pg

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined
  // eslint-disable-next-line no-var
  var __pgDb: NodePgDatabase<typeof schema> | undefined
}

function getDb(): NodePgDatabase<typeof schema> {
  if (global.__pgDb) return global.__pgDb
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  // max: пул общий для веб-запросов И воркера (тот же процесс). При параллельном воркере
  // (SETFORK_JOB_CONCURRENCY) + поллинге статуса десятками клиентов 10 коннектов насыщались.
  // connectionTimeoutMillis: без него acquire ждал коннект БЕСКОНЕЧНО (дефолт 0) — под нагрузкой
  // весь сайт тихо вис. Лучше быстрый явный отказ, чем зависание. Крутится env'ом.
  // min (DB_POOL_MIN, дефолт 0 = как было): столько соединений пул не отпускает по
  // idle-таймауту. Нужно там, где дорог сам КОННЕКТ, а не запрос: на Windows
  // порт-прокси Docker Desktop теряет часть коннектов из пачки (замер: 6 из 25
  // параллельных → timeout), и каждая холодная страница ловила это заново.
  const pool =
    global.__pgPool ??
    new Pool({
      connectionString: url,
      max: Math.max(10, Number(process.env.DB_POOL_MAX) || 20),
      min: Math.max(0, Number(process.env.DB_POOL_MIN) || 0),
      connectionTimeoutMillis: 10_000,
    })
  if (!global.__pgPool) global.__pgPool = pool
  const database = drizzle(pool, { schema })
  if (process.env.NODE_ENV !== 'production') global.__pgDb = database
  return database
}

/** Пул pg (тот же singleton, что и у Drizzle). Для низкоуровневых нужд —
 *  напр. advisory-локов, где lock+unlock должны идти по ОДНОМУ соединению. */
export function getPool(): pg.Pool {
  getDb() // гарантирует ленивую инициализацию пула
  return global.__pgPool!
}

export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
  {
    get(_, prop) {
      const real = getDb() as unknown as Record<string | symbol, unknown>
      return real[prop as string]
    },
  },
)

export * from './schema'
export { publiclyVisible } from './visibility'

/**
 * Кто исполняет запрос: сам пул или транзакция вызывающего.
 *
 * Нужен там, где проверка и запись обязаны идти ПОД ОДНИМ замком: помощник, зовущий `db`
 * напрямую, взял бы отдельное соединение — и замок вызывающего его бы не покрывал. Живёт
 * рядом с `db`, а не в фиче: просят его уже двое (правило последнего входа, заявка тревоги).
 */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
