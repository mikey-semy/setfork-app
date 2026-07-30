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
 * Неизвестный тип (свои enum'ы, экзотика расширений) даёт null — «не знаю»; такие пары
 * считаются совпавшими. Барьер скорее пропустит редкий случай, чем встанет поперёк
 * каждой миграции: он страхует от тихой потери, а не заменяет чтение диффа схемы.
 */
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
export function plannedDrops(expected: Schema, have: Schema): PlannedChanges {
  const tables = [...have.keys()].filter((t) => !expected.has(t) && !NOT_OURS.has(t))
  const columns: string[] = []
  const retypes: PlannedChanges['retypes'] = []
  for (const [table, cols] of have) {
    const exp = expected.get(table)
    if (!exp) continue // таблица целиком уже в tables
    for (const [col, haveType] of cols) {
      const expType = exp.get(col)
      if (expType === undefined) {
        columns.push(`${table}.${col}`)
        continue
      }
      const from = typeFamily(haveType)
      const to = typeFamily(expType)
      if (from && to && from !== to) retypes.push({ column: `${table}.${col}`, from: haveType, to: expType })
    }
  }
  return { tables, columns, retypes }
}
