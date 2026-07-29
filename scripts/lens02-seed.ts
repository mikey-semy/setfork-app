/**
 * Линза 02, пункт 2 «чужие данные»: сид для матрицы зрителей.
 * Создаёт 4 роли и 4 списка (публичный/приватный/черновик/снятый модерацией) с
 * маркерами-канарейками в КАЖДОМ поле, которое может утечь, и печатает готовые
 * cookie-сессии (JWT как у приложения) для curl-обхода всех поверхностей.
 *
 * Запуск: DATABASE_URL=... AUTH_SECRET=... npx tsx scripts/lens02-seed.ts
 */
import { sql } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { db, users, templates, templateVersions, steps, collaborators, sessions } from '../src/shared/db'

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET!)

async function mint(userId: string, handle: string): Promise<string> {
  const [s] = await db.insert(sessions).values({ userId }).returning({ id: sessions.id })
  return await new SignJWT({ userId, handle, sid: s.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET)
}

async function makeList(
  ownerId: string,
  slug: string,
  over: Partial<typeof templates.$inferInsert>,
  marker: string,
): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({
      ownerId,
      slug,
      title: { en: `Title-${marker}`, ru: `Заголовок-${marker}` },
      desc: { en: `Desc-${marker}`, ru: `Описание-${marker}` },
      tags: [`tag-${marker}`],
      currentVersion: 1,
      ...over,
    })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: `note-${marker}`, authorId: ownerId })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values([
    { versionId: v.id, n: 1, title: { en: `Step1-${marker}`, ru: `Шаг1-${marker}` }, desc: { en: `Body-${marker}`, ru: `Тело-${marker}` } },
    { versionId: v.id, n: 2, title: { en: `Step2-${marker}`, ru: `Шаг2-${marker}` }, desc: {} },
  ])
  return t.id
}

async function main(): Promise<void> {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)

  const mk = async (handle: string) => {
    const [u] = await db.insert(users).values({ handle, name: handle }).returning({ id: users.id })
    return u.id
  }
  const ownerId = await mk('lensowner')
  const strangerId = await mk('lensstranger')
  const collabId = await mk('lenscollab')
  const adminId = await mk('lensadmin') // ADMIN_HANDLES=lensadmin

  const pub = await makeList(ownerId, 'pub-list', {}, 'PUB')
  const priv = await makeList(ownerId, 'priv-list', { visibility: 'private' }, 'PRIVATECANARY')
  const draft = await makeList(ownerId, 'draft-list', { status: 'draft' }, 'DRAFTCANARY')
  const flagged = await makeList(ownerId, 'flagged-list', { moderation: 'flagged' }, 'FLAGGEDCANARY')

  // Коллаборатор на приватном и черновике — отдельная роль матрицы.
  for (const id of [priv, draft]) {
    await db.insert(collaborators).values({ templateId: id, userId: collabId })
  }

  const cookies = {
    owner: await mint(ownerId, 'lensowner'),
    stranger: await mint(strangerId, 'lensstranger'),
    collab: await mint(collabId, 'lenscollab'),
    admin: await mint(adminId, 'lensadmin'),
  }
  console.log(JSON.stringify({ ids: { pub, priv, draft, flagged }, cookies }, null, 2))
  process.exit(0)
}

main()
