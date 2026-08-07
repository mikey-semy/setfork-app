import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'

/**
 * Общее для серверных экшенов библиотеки: ленивый доступ к git-порту и ник владельца.
 *
 * Файл БЕЗ 'use server' намеренно: это не экшены, а помощники, и директива обязала бы
 * каждый экспорт быть асинхронным экшеном, доступным из браузера.
 */

/**
 * Ленивый доступ к git-порту и его ошибкам.
 *
 * Импорт динамический не ради красоты: серверные экшены этого файла в большинстве
 * своём git не трогают, а порт тянет за собой ядро. Один помощник вместо копии
 * этих импортов в каждом git-экшене (их уже пять).
 *
 * Держим ЕДИНСТВЕННОЙ точкой файла, знающей про `features/git`: каждый новый
 * прямой импорт туда — ещё одно кросс-фичевое нарушение границ, а их счётчик в
 * baseline линтера ограничен, превысишь — и он начинает сыпать по всему файлу разом.
 *
 * Канонической сериализации здесь больше нет: формат принадлежит ядру, наружу
 * уходит СОДЕРЖИМОЕ версии (HQ tracks/git-format.md, Ф0a).
 */
export async function gitPort() {
  const [core, ports] = await Promise.all([import('@/features/git/core'), import('@/core')])
  return { gitCore: core.gitCore, BranchOpError: ports.BranchOpError }
}

/** Ник владельца: из него собираются пути страниц и адреса git-репозиториев. */
export async function ownerHandle(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return u.handle
}
