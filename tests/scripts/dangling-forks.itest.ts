import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearDanglingForks, clearDanglingReverts } from '../../scripts/migrate-push'
import { db, suggestions, templates, users } from '@/shared/db'
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

/**
 * То же самое для связи ОТКАТА — `revert_of_id` был единственной ссылкой таблицы
 * предложений без внешнего ключа. Сценарий висячей ссылки: автор удаляет аккаунт, его
 * предложение уходит каскадом, а откат остаётся указывать в никуда.
 */
describe('висячая ссылка отката', () => {
  it('без шага миграции ключ не встаёт, после шага — встаёт', async () => {
    const { rows: fk } = await pool.query<{ name: string }>(
      `SELECT con.conname AS name
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
        WHERE con.contype = 'f' AND rel.relname = 'suggestions' AND a.attname = 'revert_of_id'`,
    )
    expect(fk, 'внешнего ключа на revert_of_id нет — тест проверял бы пустоту').toHaveLength(1)
    const name = fk[0].name
    const ADD = `ALTER TABLE suggestions ADD CONSTRAINT ${name} FOREIGN KEY (revert_of_id) REFERENCES suggestions(id) ON DELETE SET NULL`

    const [o] = await db.insert(users).values({ handle: `${OWNER}-r`, name: OWNER }).returning({ id: users.id })
    const [t] = await db
      .insert(templates)
      .values({ ownerId: o.id, slug: 'df-revert', title: { en: 'r' }, currentVersion: 1 })
      .returning({ id: templates.id })

    await pool.query(`ALTER TABLE suggestions DROP CONSTRAINT ${name}`)
    try {
      const ghost = '00000000-0000-0000-0000-0000000000ee'
      await db.insert(suggestions).values({
        templateId: t.id,
        authorId: o.id,
        number: 1,
        note: 'откат в никуда',
        items: [],
        baseVersion: 1,
        revertOfId: ghost,
      })
      await expect(pool.query(ADD), 'ключ на грязных данных обязан падать').rejects.toThrow()
      expect(await clearDanglingReverts(pool)).toBe(1)
      const [row] = await db.select({ r: suggestions.revertOfId }).from(suggestions).where(eq(suggestions.templateId, t.id))
      expect(row.r).toBeNull()
    } finally {
      await pool.query(`ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS ${name}`)
      await pool.query(ADD)
      await db.delete(users).where(eq(users.handle, `${OWNER}-r`))
    }
  })
})
