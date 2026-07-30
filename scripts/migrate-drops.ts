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

/**
 * Что `push --force` удалил бы: есть в БД, нет в схеме кода.
 *
 * `push --force` принимает и разрушающие statements, поэтому будущее переименование или
 * удаление колонки прод потерял бы МОЛЧА, вместо того чтобы остановить одноразовый
 * контейнер и позвать человека (P1 из авто-ревью #347).
 */
export function plannedDrops(
  expected: Map<string, Set<string>>,
  have: Map<string, Set<string>>,
): { tables: string[]; columns: string[] } {
  const tables = [...have.keys()].filter((t) => !expected.has(t) && !NOT_OURS.has(t))
  const columns: string[] = []
  for (const [table, cols] of have) {
    const exp = expected.get(table)
    if (!exp) continue // таблица целиком уже в tables
    for (const c of cols) if (!exp.has(c)) columns.push(`${table}.${c}`)
  }
  return { tables, columns }
}
