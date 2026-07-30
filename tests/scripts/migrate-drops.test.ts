import { describe, expect, it } from 'vitest'
import { plannedDrops } from '../../scripts/migrate-drops'

/**
 * ПРОД-МИГРАЦИЯ НЕ УДАЛЯЕТ МОЛЧА.
 *
 * `drizzle-kit push --force` принимает и разрушающие statements: будущее переименование
 * или удаление колонки прод потерял бы вместе с данными, вместо того чтобы остановить
 * одноразовый контейнер и позвать человека (P1 из авто-ревью #347).
 *
 * Барьер стоит ДО push и опирается на эту функцию: всё, что есть в БД и отсутствует в
 * схеме кода, — кандидат на удаление.
 */
const m = (o: Record<string, string[]>) => new Map(Object.entries(o).map(([t, c]) => [t, new Set(c)]))

describe('что удалил бы push --force', () => {
  it('схемы совпадают → удалять нечего', () => {
    const same = { users: ['id', 'handle'], templates: ['id', 'slug'] }
    expect(plannedDrops(m(same), m(same))).toEqual({ tables: [], columns: [] })
  })

  it('колонка есть в БД, но не в коде — это удаление данных', () => {
    const drops = plannedDrops(m({ users: ['id', 'handle'] }), m({ users: ['id', 'handle', 'old_email'] }))
    expect(drops.columns).toEqual(['users.old_email'])
    expect(drops.tables).toEqual([])
  })

  it('переименование выглядит как удаление + добавление — и тоже останавливает', () => {
    // Код ждёт display_name, в БД лежит name: push снёс бы name со всем содержимым.
    const drops = plannedDrops(m({ users: ['id', 'display_name'] }), m({ users: ['id', 'name'] }))
    expect(drops.columns).toEqual(['users.name'])
  })

  it('таблица есть в БД, но не в коде — тоже удаление', () => {
    const drops = plannedDrops(m({ users: ['id'] }), m({ users: ['id'], legacy_runs: ['id', 'payload'] }))
    expect(drops.tables).toEqual(['legacy_runs'])
    // Колонки такой таблицы отдельно не перечисляем — она уходит целиком.
    expect(drops.columns).toEqual([])
  })

  it('журнал самих миграций drizzle не считаем лишним', () => {
    const drops = plannedDrops(m({ users: ['id'] }), m({ users: ['id'], __drizzle_migrations: ['id', 'hash'] }))
    expect(drops).toEqual({ tables: [], columns: [] })
  })

  it('добавления не мешают: новой колонки в БД пока нет — это обычная волна схемы', () => {
    const drops = plannedDrops(m({ users: ['id', 'handle', 'lang'] }), m({ users: ['id', 'handle'] }))
    expect(drops).toEqual({ tables: [], columns: [] })
  })
})
