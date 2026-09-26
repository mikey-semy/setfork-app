import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { filledColumns } from '../../scripts/migrate-push'

/**
 * БАРЬЕР МИГРАЦИИ ОТПУСКАЕТ ТОЛЬКО ПУСТУЮ КОЛОНКУ.
 *
 * Удаление колонки, где нет ни одного значения, данных не теряет — так ушла
 * users.list_lang (ADR-0030). Но стоит в ней появиться хоть одной строке, барьер обязан
 * снова встать. Проверяется на живой БД: правило — это SQL, и подмена базы проверяла бы
 * подмену. Имя колонки намеренно совпадает со словом SQL — без кавычек запрос упал бы.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TABLE = 'filled_columns_probe'
const [ORDER, NOTE, TAIL] = [`${TABLE}.order`, `${TABLE}.note`, `${TABLE}.tail`]

// Таблица заново перед КАЖДЫМ кейсом: заполнение одного не должно решать исход другого.
beforeEach(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`)
  await pool.query(`CREATE TABLE ${TABLE} (id int, "order" text, note text, tail text)`)
  await pool.query(`INSERT INTO ${TABLE} (id) VALUES (1), (2)`)
})

afterAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`)
  await pool.end()
})

describe('filledColumns', () => {
  it('колонка из одних NULL не считается данными', async () => {
    expect(await filledColumns(pool, [ORDER, NOTE])).toEqual([])
  })

  it('одно значение — и барьер снова держит, где бы колонка ни стояла в списке', async () => {
    await pool.query(`UPDATE ${TABLE} SET "order" = 'x' WHERE id = 2`)
    await pool.query(`UPDATE ${TABLE} SET tail = 'y' WHERE id = 1`)
    expect(await filledColumns(pool, [NOTE, ORDER, NOTE, TAIL])).toEqual([ORDER, TAIL])
  })

  it('колонка, заполненная во всех строках, — данные', async () => {
    expect(await filledColumns(pool, [`${TABLE}.id`])).toEqual([`${TABLE}.id`])
  })
})
