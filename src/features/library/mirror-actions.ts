'use server'
// Ф3: настройка push-зеркала списка (GitHub/GitLab). SetFork — источник истины,
// форджа — витрина и резервная копия. Пушит ЯДРО (после каждой записи main и по
// кнопке); здесь — хранение настроек и ручной толчок через порт GitCore.
import { createHash, createCipheriv, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { pushListMirror } from './actions'

// Шифрование токена — формат shared/auth/totp.ts (base64(iv|tag|ct), AES-256-GCM),
// но ключ от ОБЩЕГО с ядром секрета: расшифровывает ядро при пуше.
function mirrorKey(): Buffer {
  const secret = process.env.SETFORK_MIRROR_SECRET
  if (!secret) throw new Error('SETFORK_MIRROR_SECRET is not set (общий секрет фронта и ядра)')
  return createHash('sha256').update(`mirror:${secret}`).digest()
}

function encryptMirrorToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mirrorKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

// Зеркало правил ядра (mirror.rs::valid_mirror_url): только https, без кредов в URL.
function validMirrorUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false
  const rest = url.slice('https://'.length)
  const host = rest.split('/')[0] ?? ''
  return host.length > 0 && !host.includes('@') && rest.includes('/')
}

async function ownedList(templateId: string, userId: string) {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== userId) return null // токены — только владельцу
  return tpl
}

async function settingsPath(tpl: { ownerId: string; slug: string }): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  return `/${u?.handle}/${tpl.slug}/settings`
}

/** Сохранить настройки зеркала и сразу толкнуть первый пуш (статус — в БД). */
export async function saveMirror(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const tpl = await ownedList(templateId, session.userId)
  if (!tpl) return
  const url = String(formData.get('url') ?? '').trim()
  const token = String(formData.get('token') ?? '').trim()
  if (!validMirrorUrl(url)) return // форма также валидирует; тихо не портим состояние
  // Пустой токен при уже настроенном зеркале = «оставить прежний» (его не показываем).
  const tokenEnc = token ? encryptMirrorToken(token) : tpl.mirrorToken
  if (!tokenEnc) return // первый раз токен обязателен
  // Ф2: счётчик неудач обнуляем вместе с ошибкой. Владелец только что поменял
  // настройки — это попытка с чистого листа, а не продолжение прежней серии.
  // Иначе зеркало, дошедшее до потолка со старым токеном, объявило бы «повторы
  // прекращены» сразу после первой же осечки с новым.
  await db
    .update(templates)
    .set({ mirrorUrl: url, mirrorToken: tokenEnc, mirrorError: null, mirrorAttempts: 0 })
    .where(eq(templates.id, templateId))
  // Первый пуш сразу: владелец увидит результат, не дожидаясь следующей версии.
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner) await pushListMirror(owner.handle, tpl.slug)
  revalidatePath(await settingsPath(tpl))
}

/** Отключить зеркало (репозиторий на фордже НЕ трогаем — просто перестаём пушить). */
export async function disableMirror(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await ownedList(templateId, session.userId)
  if (!tpl) return
  await db
    .update(templates)
    .set({ mirrorUrl: null, mirrorToken: null, mirrorSyncedAt: null, mirrorError: null, mirrorAttempts: 0 })
    .where(eq(templates.id, templateId))
  revalidatePath(await settingsPath(tpl))
}

/** Пуш зеркала сейчас (кнопка «Синхронизировать» / «Повторить»). */
export async function mirrorNow(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await ownedList(templateId, session.userId)
  if (!tpl?.mirrorUrl) return
  // Ф2: ручной толчок начинает серию заново. Это единственный выход из состояния
  // «повторы прекращены»: владелец починил доступ и просит попробовать ещё —
  // значит и автоматические повторы обязаны снова работать, а не ждать, пока
  // повезёт с одного раза. Провалится и эта попытка — ядро вернёт счётчик к 1.
  await db.update(templates).set({ mirrorAttempts: 0 }).where(eq(templates.id, templateId))
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner) await pushListMirror(owner.handle, tpl.slug)
  revalidatePath(await settingsPath(tpl))
}
