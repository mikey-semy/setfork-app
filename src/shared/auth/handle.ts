// Handle (ник) — правила и генерация уникального при OAuth-регистрации.
import { randomBytes } from 'crypto'
import { and, ne, sql } from 'drizzle-orm'
import { db, userRedirects, users } from '@/shared/db'
import { handleHoldAlive, handleHoldUntil } from '@/shared/db/resolve-list'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { RESERVED_TOP } from '@/shared/nav/reserved-top'
import { translitRu } from '@/shared/lib/translit'
import { normalizeHandle } from './handle-input'

export { translitRu }
// Нормализация ввода живёт в чистом модуле: её зовёт и клиентское поле ника.
export { normalizeHandle }
export const HANDLE_RE = /^[a-z0-9-]{3,30}$/
export const RESERVED_HANDLES = new Set([
  // ВСЕ корневые сегменты приложения: адрес профиля — это `/<ник>`, поэтому ник,
  // совпавший с разделом, делает профиль недоступным (раздел выигрывает). Список
  // берётся из одного источника с шапкой, а не переписывается рядом: рукописная
  // копия уже отставала — `tags` и `collections` можно было занять, хотя страницы
  // с такими адресами существуют.
  ...RESERVED_TOP,
  // 'demo' зарезервирован: getOrCreateDemoUser ищет по handle — регистрация ника
  // «demo» отдала бы чужой аккаунт публичному demo-входу.
  'demo',
  // 'gardener' — по тому же правилу: сервисный аккаунт садовника ищется по нику
  // (features/gardener/service.ts, admin/development-queries.ts).
  'gardener',
  // 'ghost' — владелец списков удалённого аккаунта.
  'ghost',
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

/**
 * ПОЧЕМУ ник нельзя занять — или `null`, если можно.
 *
 * Причина нужна отказу: «занят» и «освободится 3 марта» — разные сообщения, и второе
 * человек может дождаться, вместо того чтобы гадать. `handleTaken` ниже — та же
 * проверка, сведённая к да/нет, для тех, кому причина не нужна.
 *
 * ⚠️ ЕДИНСТВЕННЫЙ источник правды о занятости. Всякий путь, заводящий ник, обязан
 * спросить ЗДЕСЬ, а не ходить в `users` своим запросом: отдельные проверки отстают
 * молча. Регистрация так и отстала — знала про живые ники и админские, не знала про
 * удержание (H1-001); до неё тем же способом отставала проверка админ-ников (#476).
 */
export type HandleBlock =
  | { reason: 'reserved' }
  | { reason: 'taken' }
  | { reason: 'held'; until: Date }

export async function handleBlock(h: string, exceptUserId?: string): Promise<HandleBlock | null> {
  const norm = normalizeHandle(h)
  // admin-ники (ADMIN_HANDLES) НЕЛЬЗЯ занять сменой ника/регистрацией — иначе privesc
  // до админа через самоназначаемый handle (security-скан 2026-07-23, F9).
  if (RESERVED_HANDLES.has(norm) || isAdminHandle(norm)) return { reason: 'reserved' }
  // Сверка занятости БЕЗ учёта регистра: колонка — обычный text unique (в Postgres
  // регистрозависимо), а isAdminHandle лоуэркейсит. В этом зазоре жил обход УЖЕ
  // ЗАНЯТОГО админ-ника вариантом регистра: при живом mikey-semy проходил MIKEY-SEMY,
  // и getAdmin() считал его админом (линза 02, F1).
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.handle}) = ${norm}`)
    .limit(1)
  if (row) return { reason: 'taken' }
  // Прежний ник занят, ПОКА ДЕЙСТВУЕТ УДЕРЖАНИЕ: он всё ещё ведёт на своего человека —
  // из чужих ссылок, из git remote в клонах его списков, — и отдать его сейчас значило
  // бы передать вместе с ним чужой трафик. Gitea и GitHub освобождают имя сразу
  // (DeleteUserRedirect в createUser), из-за чего ссылки рвутся в ту же секунду; вечно
  // держать тоже нельзя — ники общий и конечный ресурс. Срок — в resolve-list.
  const [previous] = await db
    .select({ id: userRedirects.id, createdAt: userRedirects.createdAt })
    .from(userRedirects)
    .where(
      and(
        sql`lower(${userRedirects.handle}) = ${norm}`,
        handleHoldAlive(),
        // СВОИ прежние ники не блокируют: иначе к собственному прежнему имени нельзя
        // вернуться — та же ловушка, что была с прежними адресами списков.
        ...(exceptUserId ? [ne(userRedirects.userId, exceptUserId)] : []),
      ),
    )
    .limit(1)
  return previous ? { reason: 'held', until: handleHoldUntil(previous.createdAt) } : null
}

/** Занят ли ник — да/нет. Обёртка над `handleBlock`, чтобы причина считалась один раз
 *  и в одном месте: две независимые проверки занятости уже расходились. */
export async function handleTaken(h: string, exceptUserId?: string): Promise<boolean> {
  return (await handleBlock(h, exceptUserId)) !== null
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
