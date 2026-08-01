/**
 * Бутстрап БД вне схемы drizzle — то, что `db:push` НЕ делает (линза 07,
 * реестр 2026-08-01: на чистой инсталляции поиск падал 500 —
 * `operator does not exist: unknown <% text`).
 *
 *   pre  — до push: расширения (vector нужен самой схеме, pg_trgm — поиску).
 *   post — после push: канон поиска из drizzle/0028_search_fts.sql
 *          (порог word_similarity + GIN-индексы, чьи выражения обязаны
 *          буквально совпадать с queries.ts — поэтому SQL НЕ дублируется,
 *          а исполняется из файла миграции; он идемпотентен).
 *
 * Чистая БД одной командой: `npm run db:init`
 * (= bootstrap pre → drizzle-kit push --force → bootstrap post).
 * Прод-миграция (scripts/migrate-push.ts) вызывает эти же фазы сама —
 * отдельная команда нужна только локальному кругу (Codex #652).
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

/** Клиент с одним query(sql) — и pg.Client, и pg.Pool подходят. */
interface Queryable {
  query(sql: string): Promise<unknown>
}

/** До push: расширения, нужные схеме (vector) и поиску (pg_trgm). */
export async function bootstrapPre(db: Queryable): Promise<void> {
  await db.query('CREATE EXTENSION IF NOT EXISTS vector')
  await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
}

/** После push: канон поиска — исполняем сам файл миграции 0028 (идемпотентен). */
export async function bootstrapPost(db: Queryable): Promise<void> {
  const sql = readFileSync(join(process.cwd(), 'drizzle', '0028_search_fts.sql'), 'utf8')
  await db.query(sql)
}

// CLI: tsx scripts/db-bootstrap.ts <pre|post>
async function main(): Promise<void> {
  const phase = process.argv[2]
  if (phase !== 'pre' && phase !== 'post') {
    console.error('usage: tsx scripts/db-bootstrap.ts <pre|post>')
    process.exit(2)
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL не задан (ни в окружении, ни в .env)')
    process.exit(2)
  }
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    if (phase === 'pre') {
      await bootstrapPre(client)
      console.log('bootstrap pre: расширения vector + pg_trgm на месте')
    } else {
      await bootstrapPost(client)
      console.log('bootstrap post: канон поиска (порог word_similarity + GIN-индексы) применён')
    }
  } finally {
    await client.end()
  }
}

// Только при прямом запуске: migrate-push импортирует фазы как функции.
if (process.argv[1]?.includes('db-bootstrap')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
