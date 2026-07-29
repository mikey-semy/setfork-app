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
// verify: после push схема БД сверяется со схемой КОДА целиком и автоматически.
//
// Раньше здесь стоял рукописный список маркеров — и он оказался ровно тем, чем
// бывает любой рукописный список: его перестали пополнять. Инцидент 2026-07-29:
// прод отстал на 10 таблиц и 21 колонку, push молча не применился (TTY-промпт с
// EXIT 0), а verify отчитался «маркеры на месте» — потому что проверял старые.
// Теперь сверяется ВСЁ: пропущенная волна схемы физически не может пройти мимо.
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

// Типы, которые проверяем ОТДЕЛЬНО: наличия колонки мало, важен udt (push умеет
// сменить тип наполовину — см. случай 2 в шапке).
const TYPE_MARKERS: Array<{ table: string; column: string; udt: string }> = [
  { table: 'embeddings', column: 'embedding', udt: 'halfvec' }, // P4 #380
]

/** Ожидаемая схема ИЗ КОДА: таблицы и колонки, как их описывает schema.ts. */
function expectedSchema(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  // drizzle-kit export печатает полный DDL по schema.ts, ни к чему не подключаясь.
  const res = spawnSync('npx', ['drizzle-kit', 'export'], { encoding: 'utf8', shell: true })
  if (res.status !== 0 || !res.stdout) throw new Error(`drizzle-kit export не отработал: ${res.stderr?.slice(0, 300)}`)
  for (const m of res.stdout.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "?(\w+)"?\s*\(([\s\S]*?)\n\);/g)) {
    const cols = new Set<string>()
    for (const line of m[2].split('\n')) {
      const t = line.trim()
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)/i.test(t)) continue
      const c = /^"(\w+)"\s+/.exec(t)
      if (c) cols.add(c[1])
    }
    out.set(m[1], cols)
  }
  if (out.size === 0) throw new Error('drizzle-kit export не дал ни одной таблицы — сверять нечем')
  return out
}

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

  // ПОЛНАЯ сверка: что описано в коде — то обязано быть в БД.
  const expected = expectedSchema()
  const { rows: actual } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  )
  const have = new Map<string, Set<string>>()
  for (const r of actual) {
    if (!have.has(r.table_name)) have.set(r.table_name, new Set())
    have.get(r.table_name)!.add(r.column_name)
  }
  const missingTables: string[] = []
  const missingCols: string[] = []
  for (const [table, cols] of expected) {
    const got = have.get(table)
    if (!got) {
      missingTables.push(table)
      continue
    }
    for (const c of cols) if (!got.has(c)) missingCols.push(`${table}.${c}`)
  }
  if (missingTables.length || missingCols.length) {
    console.error('[verify] СХЕМА БД ОТСТАЛА ОТ КОДА — push не применился полностью.')
    if (missingTables.length) console.error(`[verify] нет таблиц (${missingTables.length}): ${missingTables.join(', ')}`)
    if (missingCols.length) console.error(`[verify] нет колонок (${missingCols.length}): ${missingCols.slice(0, 40).join(', ')}`)
    console.error('[verify] приложение с такой схемой упадёт на первом же запросе — запуск остановлен.')
    process.exit(1)
  }

  for (const m of TYPE_MARKERS) {
    const { rows } = await pool.query(
      `SELECT udt_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [m.table, m.column],
    )
    if (rows.length === 0 || (rows[0] as { udt_name?: string }).udt_name !== m.udt) {
      console.error(`[verify] тип не тот: ${m.table}.${m.column} ожидался ${m.udt} — push применился наполовину`)
      process.exit(1)
    }
  }

  await pool.end()
  console.log(`[migrate] push применён, схема сверена целиком: ${expected.size} таблиц`)
}

main().catch((e) => {
  console.error('[migrate] ошибка:', e)
  process.exit(1)
})
