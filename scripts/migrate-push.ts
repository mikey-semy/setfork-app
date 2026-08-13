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
// БАРЬЕР ПРОТИВ УДАЛЕНИЯ. `push --force` принимает и разрушающие statements — то есть
// будущее переименование или удаление колонки прод потерял бы данные МОЛЧА, вместо того
// чтобы остановить одноразовый контейнер и позвать человека (P1 из авто-ревью #347).
// Поэтому ДО push сверяем, что ничего не пропадает: таблица или колонка, которая есть в
// БД и отсутствует в схеме кода, останавливает миграцию. Осознанное удаление проходит
// явным разрешением ALLOW_DESTRUCTIVE_MIGRATION=1 (и попадает в лог деплоя).
//
// Раньше здесь стоял рукописный список маркеров — и он оказался ровно тем, чем
// бывает любой рукописный список: его перестали пополнять. Инцидент 2026-07-29:
// прод отстал на 10 таблиц и 21 колонку, push молча не применился (TTY-промпт с
// EXIT 0), а verify отчитался «маркеры на месте» — потому что проверял старые.
// Теперь сверяется ВСЁ: пропущенная волна схемы физически не может пройти мимо.
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'
import { plannedDrops, type Schema, type TableColumns } from './migrate-drops'
import { bootstrapPost, bootstrapPre } from './db-bootstrap'
import { EMBEDDING_COLUMN_DIM } from '@/shared/db/schema'

// Unique-колонки существующих таблиц: [таблица, колонка, тип, констрейнт]
const PREFLIGHT_UNIQUE: Array<[string, string, string, string]> = [
  ['users', 'yandex_id', 'text', 'users_yandex_id_unique'],
  ['users', 'vk_id', 'bigint', 'users_vk_id_unique'],
  ['users', 'telegram_id', 'bigint', 'users_telegram_id_unique'],
]

// Вектор-колонки, пережившие смену типа (P4: vector(1536) → halfvec(768)) И смену
// мерности (возврат потолка на 1536, когда прод вернулся с Яндекса на OpenRouter).
// Данные НЕ конвертируются: pgvector не приводит вектор одной мерности к другой, и
// ALTER TYPE на непустой колонке просто падает. Колонка пересоздаётся пустой, индекс —
// с правильным opclass, эмбеддинги пересчитывает следующий полный реиндекс.
// Мерность — из схемы, чтобы preflight и halfvec() не разъехались.
const PREFLIGHT_HALFVEC: Array<{ table: string; column: string; dims: number; index: string }> = [
  { table: 'embeddings', column: 'embedding', dims: EMBEDDING_COLUMN_DIM, index: 'embeddings_hnsw_idx' },
]

// Типы, которые проверяем ОТДЕЛЬНО: наличия колонки мало, важен udt (push умеет
// сменить тип наполовину — см. случай 2 в шапке).
const TYPE_MARKERS: Array<{ table: string; column: string; udt: string }> = [
  { table: 'embeddings', column: 'embedding', udt: 'halfvec' }, // P4 #380
]

/** Ожидаемая схема ИЗ КОДА: таблицы, колонки и их типы, как их описывает schema.ts. */
function expectedSchema(): Schema {
  const out: Schema = new Map()
  // drizzle-kit export печатает полный DDL по schema.ts, ни к чему не подключаясь.
  const res = spawnSync('npx', ['drizzle-kit', 'export'], { encoding: 'utf8', shell: true })
  if (res.status !== 0 || !res.stdout) throw new Error(`drizzle-kit export не отработал: ${res.stderr?.slice(0, 300)}`)
  for (const m of res.stdout.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "?(\w+)"?\s*\(([\s\S]*?)\n\);/g)) {
    const cols: TableColumns = new Map()
    for (const line of m[2].split('\n')) {
      const t = line.trim()
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)/i.test(t)) continue
      // Тип — всё после имени, но БЕЗ модификаторов и хвостовой запятой:
      // «"created_at" timestamp with time zone DEFAULT now() NOT NULL,» → «timestamp with time zone».
      // Запятую в самом типе («numeric(12, 6)») отрезать нельзя — на этом разбор и
      // спотыкался, объявляя колонку отсутствующей в коде.
      const c = /^"(\w+)"\s+(.+?)\s*,?$/.exec(t)
      if (c) {
        const type = c[2].replace(/\s+(DEFAULT|NOT NULL|REFERENCES|GENERATED|PRIMARY KEY|PRIMARY|UNIQUE|CHECK)[\s\S]*$/i, '').trim()
        cols.set(c[1], type)
      }
    }
    out.set(m[1], cols)
  }
  if (out.size === 0) throw new Error('drizzle-kit export не дал ни одной таблицы — сверять нечем')
  return out
}

/**
 * Таблицы, колонки и их типы, которые СЕЙЧАС есть в БД.
 *
 * Тип берём через format_type, а не udt_name: udt_name отдаёт только базовый тип
 * («numeric»), без модификаторов, — и сужение numeric(12,6) → numeric(12,2) выглядело бы
 * совпадением, хотя оно округляет уже записанные значения (P1 из авто-ревью #600).
 * format_type даёт ровно то же, что стоит в DDL: numeric(12,6), character varying(64),
 * halfvec(768).
 */
async function dbSchema(pool: Pool): Promise<Schema> {
  const { rows } = await pool.query<{ table_name: string; column_name: string; udt_name: string }>(
    `SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS udt_name
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
  )
  const out: Schema = new Map()
  for (const r of rows) {
    if (!out.has(r.table_name)) out.set(r.table_name, new Map())
    out.get(r.table_name)!.set(r.column_name, r.udt_name)
  }
  return out
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  // Бутстрап вне схемы (линза 07): расширения — ДО push (vector нужен самой
  // схеме), канон поиска (0028) — ПОСЛЕ. Здесь, а не отдельной командой:
  // прод-контейнер и все существующие пути миграции идут через этот скрипт.
  await bootstrapPre(pool)

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

  // Уникальный индекс на СУЩЕСТВУЮЩИХ данных: если инвариант нарушался до его
  // появления, дубликаты уже лежат в таблице, и CREATE UNIQUE INDEX не пройдёт — а
  // push отчитается нулевым кодом (случай 1 в шапке файла). Ровно этот случай:
  // гонка «один аккаунт — один форк списка» могла уже создать по два форка одного
  // источника. Схлопываем детерминированно и только потом отдаём управление push.
  const dup = await pool.query(
    `SELECT owner_id, forked_from_id, count(*)::int AS c
       FROM templates WHERE forked_from_id IS NOT NULL
      GROUP BY owner_id, forked_from_id HAVING count(*) > 1`,
  )
  if (dup.rowCount) {
    console.log(`[preflight] пар (владелец, источник) с дублями форков: ${dup.rowCount}`)
    const { rows } = await pool.query(
      `WITH ranked AS (
         SELECT id, row_number() OVER (PARTITION BY owner_id, forked_from_id ORDER BY created_at, id) AS rn
           FROM templates WHERE forked_from_id IS NOT NULL
       )
       UPDATE templates t SET forked_from_id = NULL
         FROM ranked r WHERE r.id = t.id AND r.rn > 1
       RETURNING t.id`,
    )
    // Снимается только СВЯЗЬ с источником, сам список остаётся: человек мог уже
    // внести в него правки. Потерянная связь честнее потерянного содержимого, а
    // список продолжает жить как самостоятельный.
    console.log(`[preflight] отвязано от источника лишних копий: ${rows.length}`)
  }

  for (const { table, column, dims, index } of PREFLIGHT_HALFVEC) {
    // format_type, а не udt_name: udt_name отдаёт «halfvec» без мерности, и смена
    // halfvec(768) → halfvec(1536) выглядела бы как «уже переведена». Такой push падает
    // на непустой колонке («expected 768 dimensions») — то есть миграция встала бы намертво.
    const { rows } = await pool.query<{ type: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped`,
      [table, column],
    )
    const want = `halfvec(${dims})`
    if (rows.length === 0 || rows[0].type === want) continue // новой БД/уже переведена — push разберётся
    const { rows: filled } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE ${column} IS NOT NULL`,
    )
    await pool.query(`DROP INDEX IF EXISTS ${index}`)
    await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${want} USING NULL`)
    await pool.query(`CREATE INDEX IF NOT EXISTS ${index} ON ${table} USING hnsw (${column} halfvec_cosine_ops)`)
    // Говорим вслух, сколько векторов обнулилось: молча опустевший индекс читается как
    // «поиск сломался», хотя это запланированный шаг — до реиндекса работает лексика.
    console.log(
      `[preflight] ${table}.${column}: ${rows[0].type} → ${want}, индекс пересоздан;` +
        ` векторов обнулено: ${filled[0]?.n ?? '?'} — нужен полный реиндекс (/admin → Search index)`,
    )
  }

  // ── барьер против удаления ──────────────────────────────────────────
  const { tables: dropTables, columns: dropCols, retypes } = plannedDrops(expectedSchema(), await dbSchema(pool))
  if (dropTables.length || dropCols.length || retypes.length) {
    const what = [
      dropTables.length ? `таблицы: ${dropTables.join(', ')}` : '',
      dropCols.length ? `колонки: ${dropCols.slice(0, 40).join(', ')}` : '',
      retypes.length ? `смена типа: ${retypes.slice(0, 20).map((r) => `${r.column} ${r.from}→${r.to}`).join(', ')}` : '',
    ].filter(Boolean).join('; ')
    if (process.env.ALLOW_DESTRUCTIVE_MIGRATION === '1') {
      console.warn(`[preflight] РАЗРУШАЮЩАЯ МИГРАЦИЯ РАЗРЕШЕНА явно (ALLOW_DESTRUCTIVE_MIGRATION=1) → ${what}`)
    } else {
      console.error('[preflight] Схема кода расходится с БД так, что push --force потеряет данные:')
      console.error('[preflight] лишнее в БД он УДАЛИТ, а смену типа сделает с пересозданием колонки.')
      console.error(`[preflight] ${what}`)
      console.error('[preflight] Миграция остановлена. Это либо забытая правка схемы, либо осознанное удаление;')
      console.error('[preflight] во втором случае запусти с ALLOW_DESTRUCTIVE_MIGRATION=1 (и сделай бэкап).')
      process.exit(1)
    }
  }

  const push = spawnSync('npx', ['drizzle-kit', 'push', '--force'], { stdio: 'inherit', shell: true })
  if (push.status !== 0) {
    console.error(`[migrate] drizzle-kit push вернул ${push.status}`)
    process.exit(1)
  }

  await bootstrapPost(pool)
  console.log('[migrate] канон поиска (0028: порог word_similarity + GIN-индексы) применён')

  // ПОЛНАЯ сверка: что описано в коде — то обязано быть в БД.
  const expected = expectedSchema()
  const have = await dbSchema(pool)
  const missingTables: string[] = []
  const missingCols: string[] = []
  for (const [table, cols] of expected) {
    const got = have.get(table)
    if (!got) {
      missingTables.push(table)
      continue
    }
    for (const c of cols.keys()) if (!got.has(c)) missingCols.push(`${table}.${c}`)
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
