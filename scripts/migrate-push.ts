// Обёртка прод-миграции: preflight → drizzle-kit push --force → verify.
//
// Зачем: у drizzle-kit push есть вопросы, которые НЕ подавляет --force —
// добавление unique-констрейнта на существующую непустую таблицу рисует
// интерактивный select («Do you want to truncate <table>?»), без TTY кидает
// ошибку и при этом ВОЗВРАЩАЕТ exit 0. Инцидент демо 2026-07-22: migrate
// «зелёный», схема осталась старой, insert(users).returning() падал 42703,
// catch маппил это в «Email already registered» — регистрация лежала целиком.
//
// preflight: идемпотентно создаёт руками те колонки/констрейнты, про которые
// push задаёт вопросы (unique на существующей таблице). Пополнять при
// добавлении unique-колонок в существующие таблицы.
// verify: после push маркеры свежей схемы обязаны существовать — «молчаливый
// зелёный» невозможен. Пополнять маркером при каждой крупной волне схемы.
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'

// Unique-колонки существующих таблиц: [таблица, колонка, тип, констрейнт]
const PREFLIGHT: Array<[string, string, string, string]> = [
  ['users', 'yandex_id', 'text', 'users_yandex_id_unique'],
  ['users', 'vk_id', 'bigint', 'users_vk_id_unique'],
  ['users', 'telegram_id', 'bigint', 'users_telegram_id_unique'],
]

// Маркеры свежей схемы: таблица (и опционально колонка), которые обязаны
// существовать после успешного push.
const MARKERS: Array<{ table: string; column?: string }> = [
  { table: 'users', column: 'ui_font' },
  { table: 'list_links' },
  { table: 'saved_queries' },
  { table: 'knowledge_triples' },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  for (const [table, column, type, constraint] of PREFLIGHT) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`)
    // ADD CONSTRAINT не умеет IF NOT EXISTS. Повтор даёт 42710 (duplicate_object)
    // ЛИБО 42P07 (duplicate_table — за unique стоит одноимённый индекс; именно так
    // упал .com-прод, где констрейнт уже существовал) — оба значат «уже есть, ок».
    try {
      await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} UNIQUE (${column})`)
      console.log(`[preflight] ${constraint} создан`)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== '42710' && code !== '42P07') throw e
    }
  }

  const push = spawnSync('npx', ['drizzle-kit', 'push', '--force'], { stdio: 'inherit', shell: true })
  if (push.status !== 0) {
    console.error(`[migrate] drizzle-kit push вернул ${push.status}`)
    process.exit(1)
  }

  for (const m of MARKERS) {
    const { rows } = m.column
      ? await pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
          [m.table, m.column],
        )
      : await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [m.table])
    if (rows.length === 0) {
      console.error(`[verify] маркер схемы отсутствует: ${m.table}${m.column ? '.' + m.column : ''} — push не применился`)
      process.exit(1)
    }
  }

  await pool.end()
  console.log('[migrate] push применён, маркеры схемы на месте')
}

main().catch((e) => {
  console.error('[migrate] ошибка:', e)
  process.exit(1)
})
