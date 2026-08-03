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
 * Тест проверяет НАЛИЧИЕ индекса, а не план запроса: планировщик на пустой тестовой
 * базе вправе выбрать Seq Scan, и ассерт на план был бы нестабилен by design.
 */
const HOT: { table: string; index: string; columns: string[] }[] = [
  { table: 'steps', index: 'steps_version_n_idx', columns: ['version_id', 'n'] },
]

describe('индексы под горячие запросы существуют', () => {
  for (const { table, index, columns } of HOT) {
    it(`${table}: ${index} по (${columns.join(', ')})`, async () => {
      const res = await db.execute(
        sql`select indexdef from pg_indexes where tablename = ${table} and indexname = ${index}`,
      )
      const rows = (res as unknown as { rows?: { indexdef: string }[] }).rows ?? (res as unknown as { indexdef: string }[])
      expect(rows.length, `индекс ${index} отсутствует — горячий запрос идёт Seq Scan'ом`).toBe(1)
      const def = (rows[0] as { indexdef: string }).indexdef
      for (const c of columns) expect(def).toContain(c)
    })
  }
})
