import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

/**
 * У КАЖДОГО KEYSET-ПОРЯДКА ЕСТЬ ПОДДЕРЖИВАЮЩИЙ ИНДЕКС.
 *
 * Без него курсор не даёт ничего: база отдаёт по индексу родителя ВЕСЬ тред и сортирует
 * его целиком ради двадцати строк. Замер 19.08 на треде в 20 000 реплик — `Index Scan` на
 * 20 000 строк плюс `top-N heapsort`; с индексом под порядок — `Index Only Scan` на 21
 * строку, а условие курсора становится `Index Cond`, то есть настоящим диапазонным
 * сканом. Цена порции перестаёт зависеть от длины треда — ровно то, ради чего листание и
 * заводилось.
 *
 * Проверяем СОСТАВ индекса в базе, а не план запроса. План зависит от объёма данных: на
 * пустой тестовой базе планировщик выберет seq scan независимо от индексов, и тест либо
 * потребует сеять тысячи строк, либо будет врать. Состав индекса — то, что мы правда
 * контролируем схемой, и его исчезновение поймается сразу.
 */

const { db } = await import('@/shared/db')

/** Колонки индекса по имени — из системного каталога, а не из схемы кода. */
const columnsOf = async (index: string): Promise<string> => {
  const r = await db.execute(sql`select indexdef from pg_indexes where indexname = ${index}`)
  const rows = (r as unknown as { rows: { indexdef: string }[] }).rows ?? (r as unknown as { indexdef: string }[])
  return rows[0]?.indexdef ?? ''
}

describe('индексы под keyset-порядки', () => {
  it.each([
    ['issue_comments_issue_idx', ['issue_id', 'created_at', 'id']],
    ['discussion_comments_discussion_idx', ['discussion_id', 'created_at', 'id']],
    ['suggestion_comments_sug_idx', ['suggestion_id', 'created_at', 'id']],
  ])('тред %s упорядочен индексом целиком', async (name, cols) => {
    const def = await columnsOf(name)
    expect(def, name).not.toBe('')
    // Порядок колонок важен: родитель первым, иначе диапазонного скана не выйдет.
    expect(def.replace(/\s+/g, ' '), name).toContain(`(${cols.join(', ')})`)
  })

  it.each([
    ['notifications_recipient_created_idx', 'recipient_id, created_at DESC, id DESC'],
    ['audit_log_created_idx', 'created_at DESC, id DESC'],
  ])('лента %s отдаёт порядок сама', async (name, expected) => {
    const def = await columnsOf(name)
    expect(def, name).not.toBe('')
    expect(def.replace(/\s+/g, ' '), name).toContain(`(${expected})`)
    // Без NULLS FIRST индекс не совпадёт с `ORDER BY … DESC` и порядок не отдаст вовсе.
    expect(def, name).not.toContain('NULLS LAST')
  })
})
