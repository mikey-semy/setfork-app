/* eslint-disable no-console -- CLI-скрипт, вывод и есть интерфейс */
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
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const phase = process.argv[2]
if (phase !== 'pre' && phase !== 'post') {
  console.error('usage: tsx scripts/db-bootstrap.ts <pre|post>')
  process.exit(2)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL не задан')
  process.exit(2)
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    if (phase === 'pre') {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
      console.log('bootstrap pre: расширения vector + pg_trgm на месте')
    } else {
      const sql = readFileSync(join(process.cwd(), 'drizzle', '0028_search_fts.sql'), 'utf8')
      await client.query(sql)
      console.log('bootstrap post: канон поиска (порог word_similarity + GIN-индексы) применён')
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
