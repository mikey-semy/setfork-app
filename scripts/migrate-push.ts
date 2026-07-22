// Обёртка прод-миграции: preflight → drizzle-kit push --force → verify.
//
// Зачем: у drizzle-kit push есть вопросы и падения, которые НЕ решает --force:
// 1) unique-констрейнт на существующей непустой таблице — интерактивный select
//    («Do you want to truncate <table>?»), без TTY ошибка и при этом EXIT 0.
//    Инцидент демо 2026-07-22 (утро): migrate «зелёный», схема старая,
//    insert(users).returning() падал 42703 → «Email already registered».
// 2) переход vector→halfvec — push меняет тип колонки, но пересоздаёт индекс
//    со СТАРЫМ opclass: «operator class "vector_cosine_ops" does not accept
//    data type halfvec», часть statements не применяется — и снова EXIT 0.
//    Инцидент демо 2026-07-22 (день): push «прошёл», а users.profile_private
//    так и не появилась — сид падал 42703.
//
// preflight: идемпотентно приводит руками те места, о которые push спотыкается.
// Пополнять при добавлении unique-колонок в существующие таблицы и сменах типа
// вектор-колонок.
// verify: после push маркеры свежей схемы обязаны существовать — «молчаливый
// зелёный» невозможен. Пополнять маркером при КАЖДОЙ волне схемы (маркер —
// последняя по времени появления колонка/таблица).
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'

// Unique-колонки существующих таблиц: [таблица, колонка, тип, констрейнт]
const PREFLIGHT_UNIQUE: Array<[string, string, string, string]> = [
  ['users', 'yandex_id', 'text', 'users_yandex_id_unique'],
  ['users', 'vk_id', 'bigint', 'users_vk_id_unique'],
  ['users', 'telegram_id', 'bigint', 'users_telegram_id_unique'],
]

// Вектор-колонки, пережившие смену типа (P4: vector(1536) → halfvec(768)).
// Данные НЕ конвертируются (размерность другая, эмбеддинги пересчитывает
// реиндекс) — колонка пересоздаётся пустой, индекс — с правильным opclass.
const PREFLIGHT_HALFVEC: Array<{ table: string; column: string; dims: number; index: string }> = [
  { table: 'embeddings', column: 'embedding', dims: 768, index: 'embeddings_hnsw_idx' },
]

// Маркеры свежей схемы: таблица (и опционально колонка/тип), которые обязаны
// существовать после успешного push.
const MARKERS: Array<{ table: string; column?: string; udt?: string }> = [
  { table: 'users', column: 'ui_font' },
  { table: 'users', column: 'profile_private' }, // privacy #383
  { table: 'embeddings', column: 'embedding', udt: 'halfvec' }, // P4 #380
  { table: 'list_links' },
  { table: 'saved_queries' },
  { table: 'knowledge_triples' },
  { table: 'dig_chat_messages' }, // мини-чат раскопки как сессия
  { table: 'gnome_thanks' }, // благодарности гному (одушевление)
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  for (const [table, column, type, constraint] of PREFLIGHT_UNIQUE) {
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

  for (const { table, column, dims, index } of PREFLIGHT_HALFVEC) {
    const { rows } = await pool.query(
      `SELECT udt_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    )
    if (rows.length === 0 || rows[0].udt_name === 'halfvec') continue // новой БД/уже переведена — push разберётся
    await pool.query(`DROP INDEX IF EXISTS ${index}`)
    await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE halfvec(${dims}) USING NULL`)
    await pool.query(`CREATE INDEX IF NOT EXISTS ${index} ON ${table} USING hnsw (${column} halfvec_cosine_ops)`)
    console.log(`[preflight] ${table}.${column}: ${rows[0].udt_name} → halfvec(${dims}), индекс пересоздан`)
  }

  const push = spawnSync('npx', ['drizzle-kit', 'push', '--force'], { stdio: 'inherit', shell: true })
  if (push.status !== 0) {
    console.error(`[migrate] drizzle-kit push вернул ${push.status}`)
    process.exit(1)
  }

  for (const m of MARKERS) {
    const { rows } = m.column
      ? await pool.query(
          `SELECT udt_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
          [m.table, m.column],
        )
      : await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [m.table])
    const missing = rows.length === 0 || (m.udt && (rows[0] as { udt_name?: string }).udt_name !== m.udt)
    if (missing) {
      console.error(`[verify] маркер схемы отсутствует: ${m.table}${m.column ? '.' + m.column : ''}${m.udt ? ` (${m.udt})` : ''} — push не применился`)
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
