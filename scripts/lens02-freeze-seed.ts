/**
 * Линза 02, F3: сид «замороженный список» + контроль его состояния.
 * Печатает id/владельца/слаг и текущее число версий — чтобы после push сравнить.
 *
 * Запуск: DATABASE_URL=... npx tsx scripts/lens02-freeze-seed.ts [--check]
 */
import { desc, eq, sql } from 'drizzle-orm'
import { db, users, templates, templateVersions, steps } from '../src/shared/db'

const OWNER = 'frzowner'
const SLUG = 'frozen-list'

async function state(): Promise<void> {
  const [t] = await db
    .select({ id: templates.id, frozenAt: templates.frozenAt, current: templates.currentVersion })
    .from(templates)
    .where(eq(templates.slug, SLUG))
    .limit(1)
  const vs = await db
    .select({ v: templateVersions.version, note: templateVersions.note })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, t.id))
    .orderBy(desc(templateVersions.version))
  console.log(JSON.stringify({ id: t.id, frozenAt: t.frozenAt, currentVersion: t.current, versions: vs }, null, 2))
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) return void (await state())

  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({
      ownerId: u.id,
      slug: SLUG,
      title: { en: 'Frozen list', ru: 'Замороженный список' },
      desc: { en: 'frozen', ru: 'заморожен' },
      tags: ['frz'],
      currentVersion: 1,
      // Именно это состояние обещано как «только чтение».
      frozenAt: new Date(),
    })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'seed', authorId: u.id })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values([
    { versionId: v.id, n: 1, title: { en: 'Step one', ru: 'Шаг один' }, desc: {} },
    { versionId: v.id, n: 2, title: { en: 'Step two', ru: 'Шаг два' }, desc: {} },
  ])
  await state()
}

main().then(() => process.exit(0))
