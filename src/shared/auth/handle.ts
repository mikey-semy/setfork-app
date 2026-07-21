// Handle (ник) — правила и генерация уникального при OAuth-регистрации.
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { translitRu } from '@/shared/lib/translit'

export { translitRu }
export const HANDLE_RE = /^[a-z0-9-]{3,30}$/
export const RESERVED_HANDLES = new Set([
  'explore', 'new', 'settings', 'admin', 'login', 'register', 'notifications', 'my-lists', 'api',
  'generate', 'ghost', 'verify-email', 'forgot-password', 'reset-password', 'changelog',
  // 'demo' зарезервирован: getOrCreateDemoUser ищет по handle — регистрация ника
  // «demo» отдала бы чужой аккаунт публичному demo-входу.
  'demo',
])

/** Сырую строку (login/имя/local-part email) → кандидат handle; '' если ничего не осталось. */
export function sanitizeHandleBase(raw: string): string {
  const s = translitRu(raw)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-$/, '')
  return s.length >= 3 ? s : ''
}

async function handleTaken(h: string): Promise<boolean> {
  if (RESERVED_HANDLES.has(h)) return true
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.handle, h)).limit(1)
  return !!row
}

/**
 * Первый свободный handle из кандидатов (в порядке предпочтения); занят → суффиксы
 * -2..-9, дальше случайный. Гонку вставки ловит вызывающий по unique-ошибке.
 */
export async function uniqueHandle(rawCandidates: Array<string | null | undefined>): Promise<string> {
  const bases = rawCandidates.map((c) => sanitizeHandleBase(c ?? '')).filter(Boolean)
  if (!bases.length) bases.push('user')
  const base = bases[0]
  const candidates = [...bases, ...Array.from({ length: 8 }, (_, i) => `${base.slice(0, 27)}-${i + 2}`)]
  for (const h of candidates) if (!(await handleTaken(h))) return h
  return `${base.slice(0, 23)}-${randomBytes(3).toString('hex')}`
}
