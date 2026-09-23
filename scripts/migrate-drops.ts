// Что прод-миграция УДАЛИЛА БЫ: чистая часть барьера из migrate-push.ts.
//
// Отдельным модулем, потому что migrate-push.ts — исполняемый скрипт (зовёт main() на
// импорте и лезет в БД), а это правило должно быть покрыто обычным юнит-тестом.

/**
 * Таблицы в public, которые НЕ описываются нашей схемой и удалению не подлежат:
 * журнал самих миграций drizzle. Всё остальное лишнее — повод остановиться, а не
 * молча снести.
 */
export const NOT_OURS = new Set(['__drizzle_migrations'])

/** Колонки таблицы: имя → тип, как его называет источник (DDL кода / information_schema). */
export type TableColumns = Map<string, string>
export type Schema = Map<string, TableColumns>
/** Перечисления (pgEnum): имя типа → значения по порядку. */
export type Enums = Map<string, string[]>

/**
 * ПЕРЕЧИСЛЕНИЯ ИЗ DDL КОДА — `CREATE TYPE "public"."x" AS ENUM('a', 'b');`, как их
 * печатает `drizzle-kit export`. Отдельно от таблиц: колонки только ссылаются на тип
 * по имени, а значения живут в самом типе.
 */
export function enumsFromDdl(ddl: string): Enums {
  const out: Enums = new Map()
  for (const m of ddl.matchAll(/CREATE TYPE\s+(?:"?\w+"?\.)?"?(\w+)"?\s+AS\s+ENUM\s*\(([^)]*)\)/g)) {
    out.set(m[1], [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'")))
  }
  return out
}

/** Имя типа без кавычек и схемы: `"public"."notification_type"` → `notification_type`. */
export function bareTypeName(raw: string): string {
  return raw.trim().replace(/"/g, '').replace(/^public\./, '')
}

const FAMILIES: Record<string, string> = {
  text: 'text',
  varchar: 'text',
  'character varying': 'text',
  char: 'text',
  character: 'text',
  bpchar: 'text',
  int: 'int',
  integer: 'int',
  int2: 'int',
  int4: 'int',
  int8: 'int',
  smallint: 'int',
  bigint: 'int',
  serial: 'int',
  bigserial: 'int',
  bool: 'bool',
  boolean: 'bool',
  uuid: 'uuid',
  json: 'json',
  jsonb: 'json',
  date: 'date',
  timestamp: 'timestamp',
  timestamptz: 'timestamp',
  'timestamp with time zone': 'timestamp',
  'timestamp without time zone': 'timestamp',
  numeric: 'num',
  decimal: 'num',
  real: 'num',
  float4: 'num',
  float8: 'num',
  'double precision': 'num',
  vector: 'vector',
  halfvec: 'vector',
  bytea: 'bytes',
}

/**
 * СЕМЕЙСТВО ТИПА — грубая группа, внутри которой смена типа данные не теряет.
 *
 * Сравнивать сырые названия нельзя: одна и та же колонка в DDL кода зовётся
 * `timestamp with time zone`, а в information_schema — `timestamptz`, и барьер
 * останавливал бы каждую волну схемы подряд. Поэтому обе стороны сводим к семейству, а
 * тревога поднимается только при переходе МЕЖДУ семействами (text → uuid, int → text):
 * ровно такие переходы не проходят без потери или пересоздания колонки.
 *
 * Неизвестный тип (экзотика расширений) даёт null — «не знаю»; такие пары считаются
 * совпавшими. Свои перечисления сверяются отдельно, по имени типа (см. plannedDrops). Барьер скорее пропустит редкий случай, чем встанет поперёк
 * каждой миграции: он страхует от тихой потери, а не заменяет чтение диффа схемы.
 */
/** Числа-модификаторы типа: numeric(12, 6) → [12, 6], varchar(64) → [64], halfvec(768) → [768]. */
export function typeMods(raw: string): number[] {
  const m = /\(([^)]*)\)/.exec(raw)
  if (!m) return []
  return m[1]
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n))
}

export function typeFamily(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\(.*\)$/, '') // varchar(64) → varchar
  if (t.endsWith('[]') || t.startsWith('_')) {
    const inner = typeFamily(t.endsWith('[]') ? t.slice(0, -2) : t.slice(1))
    return inner ? `array:${inner}` : null
  }
  return FAMILIES[t] ?? null
}

export interface PlannedChanges {
  /** Таблицы, которых нет в схеме кода: push снёс бы их целиком. */
  tables: string[]
  /** Колонки, которых нет в схеме кода: push снёс бы их вместе с данными. */
  columns: string[]
  /** Колонки, у которых меняется СЕМЕЙСТВО типа: имя то же, а данные — нет. */
  retypes: { column: string; from: string; to: string }[]
  /** Значения перечислений, которых нет в коде (обычно — откат правки схемы). */
  enumValues: { enum: string; values: string[] }[]
}

/**
 * Что `push --force` изменил бы необратимо: снесёт таблицу, снесёт колонку или сменит
 * тип колонки на несовместимый.
 *
 * `push --force` принимает и разрушающие statements, поэтому будущее переименование или
 * удаление прод потерял бы МОЛЧА — вместо того чтобы остановить одноразовый контейнер и
 * позвать человека (P1 из авто-ревью #347).
 *
 * Смена типа при том же имени раньше проходила мимо барьера: обе стороны сводились к
 * ИМЕНИ колонки, и «text → uuid» выглядело как «ничего не поменялось» (P1 из авто-ревью
 * #586). Теперь сверяются имя И семейство типа.
 */
export function plannedDrops(
  expected: Schema,
  have: Schema,
  expectedEnums: Enums = new Map(),
  haveEnums: Enums = new Map(),
): PlannedChanges {
  const tables = [...have.keys()].filter((t) => !expected.has(t) && !NOT_OURS.has(t))
  const columns: string[] = []
  const retypes: PlannedChanges['retypes'] = []
  // ⚠️ УДАЛЁННОЕ ЗНАЧЕНИЕ ПЕРЕЧИСЛЕНИЯ — самый тихий вид потери. drizzle-kit для него
  // строит цепочку «колонку в text → DROP TYPE → CREATE TYPE без значения → колонку
  // обратно USING ::type», исполняет её БЕЗ транзакции, а падение последнего шага на
  // уже записанных строках глотает с кодом 0. Итог — колонка навсегда text при зелёной
  // выкатке. Случается при обычном revert правки, добавившей значение (ревью #973).
  const enumValues: PlannedChanges['enumValues'] = []
  for (const [name, values] of haveEnums) {
    const exp = expectedEnums.get(name)
    if (!exp) continue // тип целиком ушёл из кода — его колонки уже попадут в columns/retypes
    const gone = values.filter((v) => !exp.includes(v))
    if (gone.length) enumValues.push({ enum: name, values: gone })
  }
  const isEnum = (type: string) => expectedEnums.has(bareTypeName(type)) || haveEnums.has(bareTypeName(type))
  for (const [table, cols] of have) {
    const exp = expected.get(table)
    if (!exp) continue // таблица целиком уже в tables
    for (const [col, haveType] of cols) {
      const expType = exp.get(col)
      if (expType === undefined) {
        columns.push(`${table}.${col}`)
        continue
      }
      // Колонка-перечисление меняет тип (enum ↔ text, один enum → другой): семейства у
      // enum нет, и раньше такая пара «считалась совпавшей».
      if ((isEnum(haveType) || isEnum(expType)) && bareTypeName(haveType) !== bareTypeName(expType)) {
        retypes.push({ column: `${table}.${col}`, from: haveType, to: expType })
        continue
      }
      const from = typeFamily(haveType)
      const to = typeFamily(expType)
      if (from && to && from !== to) {
        retypes.push({ column: `${table}.${col}`, from: haveType, to: expType })
        continue
      }
      // Семейство то же, но СУЖЕНИЕ модификатора тоже теряет данные: numeric(12,6) →
      // numeric(12,2) округлит уже записанное, varchar(128) → varchar(64) обрежет,
      // halfvec(1536) → halfvec(768) выбросит половину вектора. Расширение (в другую
      // сторону) безопасно и тревогу не поднимает (P1 из авто-ревью #600).
      const fromMods = typeMods(haveType)
      const toMods = typeMods(expType)
      if (fromMods.length && fromMods.length === toMods.length && toMods.some((n, i) => n < fromMods[i])) {
        retypes.push({ column: `${table}.${col}`, from: haveType, to: expType })
      }
    }
  }
  return { tables, columns, retypes, enumValues }
}

/**
 * ПОСЛЕ push: перечисления и колонки на них обязаны совпасть с кодом. Наличия колонки
 * мало — push умеет применить цепочку смены типа наполовину и вернуть 0 (см. выше), и
 * тогда колонка остаётся text, хотя по имени «на месте».
 */
export function enumDrift(expected: Schema, have: Schema, expectedEnums: Enums, haveEnums: Enums): string[] {
  const out: string[] = []
  for (const [name, values] of expectedEnums) {
    const got = haveEnums.get(name)
    if (!got) {
      out.push(`нет типа ${name}`)
      continue
    }
    const missing = values.filter((v) => !got.includes(v))
    if (missing.length) out.push(`у ${name} нет значений: ${missing.join(', ')}`)
  }
  for (const [table, cols] of expected) {
    for (const [col, type] of cols) {
      const want = bareTypeName(type)
      if (!expectedEnums.has(want)) continue
      const got = have.get(table)?.get(col)
      if (got !== undefined && bareTypeName(got) !== want) out.push(`${table}.${col}: ${got} вместо ${want}`)
    }
  }
  return out
}
