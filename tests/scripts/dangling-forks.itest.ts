import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearDanglingForks } from '../../scripts/migrate-push'
import { db, templates, users } from '@/shared/db'
import { eq } from 'drizzle-orm'

/**
 * ВНЕШНИЙ КЛЮЧ НА ИСТОЧНИК ФОРКА НЕ ВСТАЁТ НА ПРОДОВЫХ ДАННЫХ.
 *
 * Пока ключа не было, удаление списка-источника оставляло у форка ссылку в никуда.
 * Такие строки на проде уже есть, поэтому ADD FOREIGN KEY на них падает — и падает
 * он не в тесте, а в одноразовом контейнере миграции, то есть деплой встаёт.
 *
 * Проверяется именно ПОРЯДОК: сначала показать, что ключ на грязных данных не
 * применяется (иначе тест ничего не доказывал бы), потом — что после шага миграции
 * он применяется. Прод-состояние воспроизводится честно: ключ снимается, строка
 * вставляется, ключ возвращается.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const OWNER = 'df-owner'

/** Имя ключа берётся ИЗ БАЗЫ: зашитое имя разошлось бы с генератором drizzle молча. */
async function fkName(): Promise<string> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT con.conname AS name
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
      WHERE con.contype = 'f' AND rel.relname = 'templates' AND a.attname = 'forked_from_id'`,
  )
  expect(rows, 'внешнего ключа на forked_from_id нет — тест проверял бы пустоту').toHaveLength(1)
  return rows[0].name
}

const ADD_FK = (name: string) =>
  `ALTER TABLE templates ADD CONSTRAINT ${name} FOREIGN KEY (forked_from_id) REFERENCES templates(id) ON DELETE SET NULL`

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
})

afterAll(async () => {
  await pool.end()
})

describe('висячая ссылка на источник форка', () => {
  it('без шага миграции ключ не встаёт, после шага — встаёт', async () => {
    const name = await fkName()
    const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })

    await pool.query(`ALTER TABLE templates DROP CONSTRAINT ${name}`)
    try {
      // Ссылка в никуда: ровно то, что оставалось на проде после удаления источника.
      const ghost = '00000000-0000-0000-0000-0000000000ff'
      await db
        .insert(templates)
        .values({ ownerId: o.id, slug: 'df-orphan', title: { en: 'orphan' }, currentVersion: 1, forkedFromId: ghost })

      await expect(pool.query(ADD_FK(name)), 'ключ на грязных данных обязан падать').rejects.toThrow()

      expect(await clearDanglingForks(pool)).toBe(1)
      const [row] = await db.select({ f: templates.forkedFromId }).from(templates).where(eq(templates.slug, 'df-orphan'))
      // Список остаётся жить — снимается только связь с исчезнувшим источником.
      expect(row.f).toBeNull()
    } finally {
      await pool.query(`ALTER TABLE templates DROP CONSTRAINT IF EXISTS ${name}`)
      await pool.query(ADD_FK(name))
    }
  })
})
