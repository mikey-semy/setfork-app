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
  const pool = global.__pgPool ?? new Pool({ connectionString: url, max: 10 })
  if (!global.__pgPool) global.__pgPool = pool
  const database = drizzle(pool, { schema })
  if (process.env.NODE_ENV !== 'production') global.__pgDb = database
  return database
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
