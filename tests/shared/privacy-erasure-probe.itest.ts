import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  aiUsage,
  auditLog,
  db,
  digChatMessages,
  embeddings,
  feedback,
  generationMessages,
  generations,
  issueComments,
  issues,
  linkClicks,
  sessions,
  steps,
  templateVersions,
  templateViews,
  templates,
  users,
} from '@/shared/db'

// ЛИНЗА 04 · «забудьте меня»: что РЕАЛЬНО исчезает при удалении аккаунта.
// Не чтение FK, а прогон настоящего deleteAccount на живой БД с посевом в тех
// таблицах, где лежат персональные данные и написанный человеком текст.

const SECRET = 'ПРИВАТНЫЙ-СПИСОК-Ж7К2'
const MY_PROMPT = 'как мне вылечиться от <болезнь> — запрос пользователя'
const MY_COMMENT = 'мой комментарий с личными подробностями'
const MY_CHAT = 'реплика в чате с гномом про мои дела'
const MY_FEEDBACK = 'жалоба с моим телефоном +7 999 000-00-00'

let victimId = ''
let listId = ''

const session = vi.hoisted(() => ({ current: null as { userId: string; handle: string; sid?: string } | null }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => session.current,
  getSession: async () => session.current,
  clearSessionCookie: async () => {},
  refreshSessionCookie: async () => {},
}))

beforeAll(async () => {
  await db.execute(sql`truncate table ${users}, ${templates}, ${embeddings}, ${auditLog}, ${feedback} restart identity cascade`)

  const [victim] = await db
    .insert(users)
    .values({
      handle: 'erase-me',
      email: 'erase-me@example.com',
      name: 'Настоящее Имя',
      bio: 'живу в Иваново, работаю тут-то',
      location: 'Ivanovo',
      passwordHash: 'scrypt$fake',
    })
    .returning({ id: users.id })
  victimId = victim.id
  const [other] = await db.insert(users).values({ handle: 'erase-other' }).returning({ id: users.id })

  // Приватный список с содержимым + его отпечаток в корпусе.
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: victimId, slug: 'my-private', title: { ru: SECRET }, visibility: 'private', currentVersion: 1 })
    .returning({ id: templates.id })
  listId = tpl.id
  const [ver] = await db.insert(templateVersions).values({ templateId: listId, version: 1 }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: ver.id, n: 1, type: 'step', title: { ru: `${SECRET} шаг` } })
  await db.insert(embeddings).values({ kind: 'list', refId: listId, content: SECRET, metadata: { title: SECRET } })

  // Следы человека в остальных таблицах.
  await db.insert(sessions).values({ userId: victimId, ip: '203.0.113.7', userAgent: 'Mozilla/5.0 probe', geo: 'Ivanovo, RU' })
  await db.insert(auditLog).values({ actorId: victimId, action: 'account.login', targetType: 'user', targetId: victimId, ip: '203.0.113.7', meta: { handle: 'erase-me' } })
  const [gen] = await db.insert(generations).values({ userId: victimId, query: MY_PROMPT }).returning({ id: generations.id })
  await db.insert(generationMessages).values({ generationId: gen.id, kind: 'user', text: MY_PROMPT })
  await db.insert(digChatMessages).values({ templateId: listId, stepN: 1, userId: victimId, role: 'user', text: MY_CHAT })
  await db.insert(aiUsage).values({ userId: victimId, feature: 'generate', model: 'test', provider: 'openrouter', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: '0' })
  await db.insert(templateViews).values({ templateId: listId, userId: victimId, visitor: `u:${victimId}`, day: '2026-07-29' })
  await db.insert(linkClicks).values({ templateId: listId, refIndex: 0, url: 'https://example.com', host: 'example.com', userId: victimId, visitor: `u:${victimId}` })
  await db.insert(feedback).values({ userId: victimId, body: MY_FEEDBACK, email: 'erase-me@example.com' })

  // Комментарий в ЧУЖОЙ задаче — текст человека внутри чужой ветки обсуждения.
  const [otherTpl] = await db
    .insert(templates)
    .values({ ownerId: other.id, slug: 'their-list', title: { ru: 'Чужой список' }, status: 'published' })
    .returning({ id: templates.id })
  const [iss] = await db
    .insert(issues)
    .values({ templateId: otherTpl.id, number: 1, title: 'вопрос', authorId: other.id })
    .returning({ id: issues.id })
  await db.insert(issueComments).values({ issueId: iss.id, authorId: victimId, body: MY_COMMENT })

  session.current = { userId: victimId, handle: 'erase-me' }
})

afterAll(async () => {
  vi.restoreAllMocks()
  await db.execute(sql`truncate table ${users}, ${templates}, ${embeddings}, ${auditLog}, ${feedback} restart identity cascade`)
})

const count = async (table: string, where: string): Promise<number> => {
  const r = await db.execute(sql.raw(`select count(*)::int as n from ${table} where ${where}`))
  return Number((r.rows[0] as { n: number }).n)
}

describe('линза 04 · удаление аккаунта: что остаётся', () => {
  it('deleteAccount отрабатывает целиком (redirect — штатное завершение)', async () => {
    const { deleteAccount } = await import('@/features/settings/actions')
    const fd = new FormData()
    fd.set('confirm', 'erase-me')
    try {
      await deleteAccount(null, fd)
    } catch (e) {
      // next/navigation redirect() бросает NEXT_REDIRECT — это успех, а не сбой.
      expect(String((e as Error).message)).toContain('NEXT_REDIRECT')
    }
    expect(await count('users', `handle = 'erase-me'`)).toBe(0)
  })

  it('ЧТО УДАЛИЛОСЬ: строка пользователя, сессии (IP/UA/гео), беседы, расход, просмотры', async () => {
    expect(await count('sessions', `user_id = '${victimId}'`)).toBe(0)
    expect(await count('generations', `user_id = '${victimId}'`)).toBe(0)
    expect(await count('generation_messages', `text = '${MY_PROMPT.replace(/'/g, "''")}'`)).toBe(0)
    expect(await count('dig_chat_messages', `user_id = '${victimId}'`)).toBe(0)
  })

  it('ЧТО ОСТАЛОСЬ: история просмотров — строка жива, связь держится ключом visitor', async () => {
    // user_id обнулён каскадом, но ключ посетителя 'u:<uuid>' остаётся в строке:
    // просмотры удалённого человека по-прежнему сшиваются между списками.
    expect(await count('template_views', `user_id is null`)).toBe(1)
    expect(await count('template_views', `visitor = 'u:${victimId}'`)).toBe(1)
  })

  it('ЧТО ОСТАЛОСЬ: приватный список целиком — переехал на ghost вместе с содержимым', async () => {
    const [row] = await db
      .select({ ownerHandle: users.handle, title: templates.title, visibility: templates.visibility })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .where(eq(templates.id, listId))
    expect(row.ownerHandle).toBe('ghost')
    expect(JSON.stringify(row.title)).toContain(SECRET)
    expect(row.visibility).toBe('private')
    // и его отпечаток в корпусе эмбеддингов
    expect(await count('embeddings', `ref_id = '${listId}'`)).toBe(1)
  })

  it('ЧТО ОСТАЛОСЬ: журнал аудита с ником и IP, обезличенный только по actorId', async () => {
    const rows = await db.select({ ip: auditLog.ip, meta: auditLog.meta, actorId: auditLog.actorId }).from(auditLog)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.ip === '203.0.113.7')).toBe(true)
    expect(rows.some((r) => JSON.stringify(r.meta).includes('erase-me'))).toBe(true)
    expect(rows.every((r) => r.actorId === null)).toBe(true)
  })

  it('ЧТО ОСТАЛОСЬ: обратная связь и клики — текст и связь по visitor', async () => {
    expect(await count('feedback', `body like '%+7 999%' and email = 'erase-me@example.com'`)).toBe(1)
    expect(await count('link_clicks', `visitor = 'u:${victimId}'`)).toBe(1)
  })

  it('ЧТО ИСЧЕЗЛО ВМЕСТЕ С ЧУЖОЙ ВЕТКОЙ: комментарий в чужой задаче удалён каскадом', async () => {
    expect(await count('issue_comments', `body = '${MY_COMMENT}'`)).toBe(0)
  })

  it('расход ИИ остаётся строкой с обнулённым автором (учёт денег переживает удаление)', async () => {
    expect(await count('ai_usage', `user_id is null`)).toBe(1)
  })
})
