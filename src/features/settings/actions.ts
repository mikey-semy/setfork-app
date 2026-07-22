'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, stars, suggestions, templates, users } from '@/shared/db'
import type { Social } from '@/shared/db/schema'
import { clearSessionCookie, refreshSessionCookie, requireSession } from '@/shared/auth/session'
import { recordAudit } from '@/shared/audit'
import { handleTaken, isHandleShapeValid, normalizeHandle } from '@/shared/auth/handle'
import { removeAvatar, saveAvatar } from './avatar'

export type ActionResult = { ok?: true; error?: string }

const ALLOWED_SOCIAL = new Set(['github', 'x', 'telegram', 'youtube', 'linkedin', 'site'])

function normalizeUrl(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`
  // Валидация: парсится как URL, схема http(s), хост с точкой (домен) или localhost.
  // Мусор («не адрес», «javascript:…») не сохраняем — вернём '' → поле очистится.
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return ''
    return u.toString()
  } catch {
    return ''
  }
}

function parseSocials(raw: string): Social[] {
  let arr: unknown
  try {
    arr = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((s) => ({ type: String((s as Social)?.type ?? '').trim(), url: normalizeUrl(String((s as Social)?.url ?? '')) }))
    .filter((s) => ALLOWED_SOCIAL.has(s.type) && s.url)
    .slice(0, 8)
}

export async function updateProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireSession()

  const name = String(formData.get('name') ?? '').trim().slice(0, 80) || null
  const bio = String(formData.get('bio') ?? '').trim().slice(0, 280) || null
  const location = String(formData.get('location') ?? '').trim().slice(0, 80) || null
  const website = normalizeUrl(String(formData.get('website') ?? '')).slice(0, 200) || null
  const socials = parseSocials(String(formData.get('socials') ?? '[]'))

  let avatarRef: string | undefined // storage_key (S3) или /uploads-путь
  const file = formData.get('avatar')
  if (file instanceof File && file.size > 0) {
    try {
      avatarRef = await saveAvatar(session.userId, file)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Не удалось загрузить аватар.' }
    }
  }

  // Явный запрос убрать аватар (и без загрузки нового): чистим хранилище + БД → аватар-плейсхолдер.
  const clearAvatar = formData.get('avatarRemove') === '1' && !avatarRef
  if (clearAvatar) await removeAvatar(session.userId).catch(() => {})

  await db
    .update(users)
    .set({ name, bio, location, website, socials, ...(avatarRef ? { avatarUrl: avatarRef } : clearAvatar ? { avatarUrl: null } : {}) })
    .where(eq(users.id, session.userId))

  // В сессии храним УЖЕ отрезолвленный URL (навбар — клиент, подписать сам не может).
  // Храним в сессии storage_key/ref (не подписанный URL) — layout резолвит на рендере.
  await refreshSessionCookie({
    userId: session.userId,
    handle: session.handle,
    name: name ?? undefined,
    avatarUrl: avatarRef ?? (clearAvatar ? undefined : session.avatarUrl ?? undefined),
  })

  // layout — чтобы обновился аватар в шапке (TopNav), а не только на страницах.
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Смена ника (handle). Ник — часть публичных URL (/handle/…), поэтому смена ломает
 *  старые ссылки (предупреждаем в UI; таблицы редиректов пока нет). GitHub-аккаунтам
 *  запрещено: upsertGithubUser синхронизирует handle с gh.login на каждом входе и
 *  откатил бы смену. Сессия обновляется без ре-логина (refreshSessionCookie). */
export async function changeHandle(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const next = normalizeHandle(String(formData.get('handle') ?? ''))

  if (!next) return { error: 'Введите новый ник.' }
  if (next === session.handle) return { error: 'Это ваш текущий ник.' }
  if (!isHandleShapeValid(next)) return { error: 'Ник: 3–30 символов, только a–z, 0–9 и дефис; некоторые слова зарезервированы.' }

  const [me] = await db.select({ githubId: users.githubId }).from(users).where(eq(users.id, session.userId)).limit(1)
  if (me?.githubId != null) {
    return { error: 'Аккаунтам, привязанным к GitHub, смена ника недоступна — он синхронизируется с GitHub при входе.' }
  }
  if (await handleTaken(next)) return { error: 'Этот ник уже занят.' }

  try {
    await db.update(users).set({ handle: next }).where(eq(users.id, session.userId))
  } catch {
    // гонка: ник заняли между проверкой и апдейтом (unique-нарушение)
    return { error: 'Этот ник уже занят.' }
  }

  await recordAudit('account.handle-change', {
    actorId: session.userId,
    targetType: 'user',
    targetId: session.userId,
    meta: { from: session.handle, to: next },
  })
  // Сессия хранит handle (используется в revalidatePath/quota-ключах) — обновляем без ре-логина.
  await refreshSessionCookie({ userId: session.userId, handle: next, name: session.name, avatarUrl: session.avatarUrl })
  revalidatePath('/', 'layout')
  redirect(`/${next}`)
}

/** Спец-аккаунт «удалённый пользователь» — под него переходят списки удалённых людей. */
async function ensureGhostUser(): Promise<string> {
  const [g] = await db.select().from(users).where(eq(users.handle, 'ghost')).limit(1)
  if (g) return g.id
  const [created] = await db.insert(users).values({ handle: 'ghost', name: 'Deleted user', deleted: true }).returning()
  return created.id
}

export async function deleteAccount(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const confirm = String(formData.get('confirm') ?? '').trim()
  if (confirm.toLowerCase() !== session.handle.toLowerCase()) {
    return { error: 'Ник не совпадает.' }
  }
  if (session.handle.toLowerCase() === 'ghost') return { error: 'Этот аккаунт нельзя удалить.' }

  const ghostId = await ensureGhostUser()

  // 1) Переносим списки на ghost, следя за уникальностью slug под ghost.
  const mine = await db.select({ id: templates.id, slug: templates.slug }).from(templates).where(eq(templates.ownerId, session.userId))
  const taken = new Set(
    (await db.select({ slug: templates.slug }).from(templates).where(eq(templates.ownerId, ghostId))).map((r) => r.slug),
  )
  for (const tpl of mine) {
    let slug = tpl.slug
    if (taken.has(slug)) {
      let i = 2
      while (taken.has(`${slug}-${i}`)) i++
      slug = `${slug}-${i}`
    }
    taken.add(slug)
    await db.update(templates).set({ ownerId: ghostId, slug }).where(eq(templates.id, tpl.id))
  }

  // 2) Авторство предложений тоже на ghost (сохраняем историю правок).
  await db.update(suggestions).set({ authorId: ghostId }).where(eq(suggestions.authorId, session.userId))

  // 3) Списки, которые пользователь звёздил, потеряют его звезду (каскад) — уменьшаем счётчик заранее.
  const starred = await db.select({ tid: stars.templateId }).from(stars).where(eq(stars.userId, session.userId))
  if (starred.length) {
    await db
      .update(templates)
      .set({ starsCount: sql`GREATEST(0, ${templates.starsCount} - 1)` })
      .where(inArray(templates.id, starred.map((r) => r.tid)))
  }

  // 4) Аудит ДО удаления: actorId ссылается на users (onDelete set null),
  // после db.delete запись потеряла бы автора. Списки переданы ghost, поэтому
  // фиксируем сколько именно передано/расзвёзжено.
  await recordAudit('account.delete', {
    actorId: session.userId,
    targetType: 'user',
    targetId: session.userId,
    meta: { handle: session.handle, listsTransferred: mine.length, starsRemoved: starred.length },
  })

  // 5) Удаляем аккаунт — каскадом уходят его звёзды, прогоны И сессии на всех
  // устройствах (FK sessions.userId → onDelete cascade): отзыв везде, не только тут.
  await removeAvatar(session.userId)
  await db.delete(users).where(eq(users.id, session.userId))

  await clearSessionCookie()
  redirect('/')
}
