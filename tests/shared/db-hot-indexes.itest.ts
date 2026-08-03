import { describe, expect, it } from 'vitest'
import { db } from '@/shared/db'
import { sql } from 'drizzle-orm'

/**
 * Индексы под горячие запросы — часть контракта схемы, а не деталь.
 *
 * Повод: у `steps` не было индекса по `version_id`, хотя это самый частый запрос
 * системы (страница списка, прогон, /raw, /export, /embed, data.json, MCP) и самая
 * быстрорастущая таблица — версия хранится полной копией блоков. PostgreSQL под
 * ссылающуюся колонку индекс не создаёт, и это легко не заметить: на маленькой базе
 * Seq Scan быстрый, а деградация приходит от размера ВСЕГО корпуса, а не своего списка.
 *
 * Проверяется НАЛИЧИЕ и ПОРЯДОК колонок, а не план запроса: планировщик на пустой
 * тестовой базе вправе выбрать Seq Scan, и ассерт на план был бы нестабилен by design.
 */
const HOT: { table: string; index: string; columns: string }[] = [
  // Порядок значим: предикат по version_id + сортировка по n. Обратный порядок
  // (n, version_id) для этого запроса бесполезен, поэтому сверяем строку целиком.
  { table: 'steps', index: 'steps_version_n_idx', columns: 'version_id, n' },
]

describe('индексы под горячие запросы существуют', () => {
  for (const { table, index, columns } of HOT) {
    it(`${table}: ${index} по (${columns})`, async () => {
      // Ключевые колонки берём из каталога в порядке следования, а не разбором
      // indexdef подстроками: имя индекса само содержит имена колонок, и проверка
      // «каждая колонка где-то упомянута» приняла бы и одноколоночный, и обратный
      // индекс — то есть осталась бы зелёной ровно тогда, когда запрос теряет путь.
      const res = await db.execute(sql`
        select a.attname as col
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        join pg_class t on t.oid = i.indrelid
        join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where t.relname = ${table} and c.relname = ${index}
        order by k.ord
      `)
      const rows = (res as unknown as { rows?: { col: string }[] }).rows ?? (res as unknown as { col: string }[])
      const actual = rows.map((r) => r.col).join(', ')
      expect(actual, `индекс ${index}: ожидались колонки (${columns}) именно в этом порядке`).toBe(columns)
    })
  }
})
