// Handle (ник) — правила и генерация уникального при OAuth-регистрации.
import { randomBytes } from 'crypto'
import { sql } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { translitRu } from '@/shared/lib/translit'

export { translitRu }
export const HANDLE_RE = /^[a-z0-9-]{3,30}$/
export const RESERVED_HANDLES = new Set([
  'explore', 'new', 'settings', 'admin', 'login', 'register', 'notifications', 'my-lists', 'api',
  'generate', 'ghost', 'verify-email', 'forgot-password', 'reset-password', 'changelog',
  // 'demo' зарезервирован: getOrCreateDemoUser ищет по handle — регистрация ника
  // «demo» отдала бы чужой аккаунт публичному demo-входу.
  'demo',
  // 'gardener' — по тому же правилу: сервисный аккаунт садовника ищется по нику
  // (features/gardener/service.ts, admin/development-queries.ts).
  'gardener',
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

export async function handleTaken(h: string): Promise<boolean> {
  const norm = normalizeHandle(h)
  // admin-ники (ADMIN_HANDLES) НЕЛЬЗЯ занять сменой ника/регистрацией — иначе privesc
  // до админа через самоназначаемый handle (security-скан 2026-07-23, F9).
  if (RESERVED_HANDLES.has(norm) || isAdminHandle(norm)) return true
  // Сверка занятости БЕЗ учёта регистра: колонка — обычный text unique (в Postgres
  // регистрозависимо), а isAdminHandle лоуэркейсит. В этом зазоре жил обход УЖЕ
  // ЗАНЯТОГО админ-ника вариантом регистра: при живом mikey-semy проходил MIKEY-SEMY,
  // и getAdmin() считал его админом (линза 02, F1).
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.handle}) = ${norm}`)
    .limit(1)
  return !!row
}

/** Нормализовать ввод ника (обрезка, нижний регистр, снятие ведущего @). */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '')
}

/** Валиден ли ник по форме (НЕ занятость): длина/алфавит + не зарезервирован. */
export function isHandleShapeValid(h: string): boolean {
  return HANDLE_RE.test(h) && !RESERVED_HANDLES.has(h) && !isAdminHandle(h)
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
