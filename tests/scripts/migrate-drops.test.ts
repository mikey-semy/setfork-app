import { describe, expect, it } from 'vitest'
import { plannedDrops, typeFamily, type Schema } from '../../scripts/migrate-drops'

/**
 * ПРОД-МИГРАЦИЯ НЕ УДАЛЯЕТ МОЛЧА.
 *
 * `drizzle-kit push --force` принимает и разрушающие statements: будущее переименование
 * или удаление колонки прод потерял бы вместе с данными, вместо того чтобы остановить
 * одноразовый контейнер и позвать человека (P1 из авто-ревью #347).
 *
 * Барьер стоит ДО push и опирается на эту функцию: всё, что есть в БД и отсутствует в
 * схеме кода, — кандидат на удаление. Плюс смена ТИПА при том же имени: она проходила
 * мимо барьера, потому что обе стороны сводились к имени колонки (P1 из авто-ревью #586).
 */
const m = (o: Record<string, Record<string, string>>): Schema =>
  new Map(Object.entries(o).map(([t, cols]) => [t, new Map(Object.entries(cols))]))

describe('что удалил бы push --force', () => {
  it('схемы совпадают → удалять нечего', () => {
    const same = { users: { id: 'uuid', handle: 'text' }, templates: { id: 'uuid', slug: 'text' } }
    expect(plannedDrops(m(same), m(same))).toEqual({ tables: [], columns: [], retypes: [] })
  })

  it('колонка есть в БД, но не в коде — это удаление данных', () => {
    const d = plannedDrops(m({ users: { id: 'uuid', handle: 'text' } }), m({ users: { id: 'uuid', handle: 'text', old_email: 'text' } }))
    expect(d.columns).toEqual(['users.old_email'])
    expect(d.tables).toEqual([])
  })

  it('переименование выглядит как удаление + добавление — и тоже останавливает', () => {
    const d = plannedDrops(m({ users: { id: 'uuid', display_name: 'text' } }), m({ users: { id: 'uuid', name: 'text' } }))
    expect(d.columns).toEqual(['users.name'])
  })

  it('таблица есть в БД, но не в коде — тоже удаление', () => {
    const d = plannedDrops(m({ users: { id: 'uuid' } }), m({ users: { id: 'uuid' }, legacy_runs: { id: 'int4', payload: 'text' } }))
    expect(d.tables).toEqual(['legacy_runs'])
    // Колонки такой таблицы отдельно не перечисляем — она уходит целиком.
    expect(d.columns).toEqual([])
  })

  it('журнал самих миграций drizzle не считаем лишним', () => {
    const d = plannedDrops(m({ users: { id: 'uuid' } }), m({ users: { id: 'uuid' }, __drizzle_migrations: { id: 'int4', hash: 'text' } }))
    expect(d).toEqual({ tables: [], columns: [], retypes: [] })
  })

  it('добавления не мешают: новой колонки в БД пока нет — это обычная волна схемы', () => {
    const d = plannedDrops(m({ users: { id: 'uuid', handle: 'text', lang: 'text' } }), m({ users: { id: 'uuid', handle: 'text' } }))
    expect(d).toEqual({ tables: [], columns: [], retypes: [] })
  })
})

describe('смена типа при том же имени', () => {
  it('text → uuid ловится: имя то же, данные — нет', () => {
    const d = plannedDrops(m({ users: { owner: 'uuid' } }), m({ users: { owner: 'text' } }))
    expect(d.retypes).toEqual([{ column: 'users.owner', from: 'text', to: 'uuid' }])
  })

  it('разные названия ОДНОГО типа тревогу не поднимают', () => {
    // В DDL кода — «timestamp with time zone», в information_schema — «timestamptz».
    const d = plannedDrops(m({ users: { created_at: 'timestamp with time zone' } }), m({ users: { created_at: 'timestamptz' } }))
    expect(d.retypes).toEqual([])
  })

  it('расширение внутри семейства (varchar → text, int4 → bigint) — не потеря', () => {
    const d = plannedDrops(m({ users: { handle: 'text', n: 'bigint' } }), m({ users: { handle: 'varchar(64)', n: 'int4' } }))
    expect(d.retypes).toEqual([])
  })

  it('незнакомый тип (свой enum) молчит: барьер не встаёт поперёк каждой миграции', () => {
    const d = plannedDrops(m({ lists: { status: 'list_status' } }), m({ lists: { status: 'list_status_v2' } }))
    expect(d.retypes).toEqual([])
  })

  it('массив и скаляр — разные семейства', () => {
    const d = plannedDrops(m({ lists: { tags: 'text[]' } }), m({ lists: { tags: 'text' } }))
    expect(d.retypes).toEqual([{ column: 'lists.tags', from: 'text', to: 'text[]' }])
  })
})

describe('семейства типов', () => {
  it('сводят синонимы к одному', () => {
    expect(typeFamily('timestamptz')).toBe(typeFamily('timestamp with time zone'))
    expect(typeFamily('varchar(64)')).toBe(typeFamily('text'))
    expect(typeFamily('int4')).toBe(typeFamily('bigint'))
    expect(typeFamily('_text')).toBe(typeFamily('text[]'))
  })

  it('незнакомое даёт null, а не ложное совпадение', () => {
    expect(typeFamily('list_status')).toBeNull()
  })
})
