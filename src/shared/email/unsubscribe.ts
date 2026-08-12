import 'server-only'
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { appOrigin } from '@/shared/auth/app-origin'
import { readToken, signToken } from '@/shared/auth/tokens'

// Отписка от писем одним кликом (RFC 8058). Gmail и Yahoo требуют этого от
// отправителей массовой почты: в письме — заголовки List-Unsubscribe и
// List-Unsubscribe-Post, по ним почтовый клиент САМ делает POST на наш адрес,
// без входа пользователя на сайт. Значит право отписаться несёт сам токен.

const PURPOSE = 'unsubscribe'

/** Токен живёт дольше письма: отписаться должно работать и через полгода. */
const TTL = '180d'

/** Путь-приёмник. POST — one-click от почтового клиента, GET — человек в браузере. */
export const UNSUBSCRIBE_PATH = '/api/unsubscribe'

/**
 * Адрес для заголовка List-Unsubscribe письма к этому получателю.
 * @param email Адрес, НА КОТОРЫЙ уходит это письмо. Он же едет в токен: ссылка
 *              действует полгода, и после смены почты старое письмо (а значит и
 *              тот, кому достался прежний ящик) не должно отключать доставку на
 *              новый адрес.
 */
export async function unsubscribeUrl(userId: string, email: string): Promise<string> {
  const token = await signToken({ uid: userId, em: email.toLowerCase(), purpose: PURPOSE }, TTL)
  return `${appOrigin()}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`
}

/**
 * Выключает почтовые уведомления по токену из письма. true — сделано.
 * Идемпотентна: повторный клик по той же ссылке снова вернёт true.
 */
export async function applyUnsubscribe(token: string): Promise<boolean> {
  const p = await readToken(token)
  if (!p || p.purpose !== PURPOSE || !p.uid || !p.em) return false
  const [u] = await db.select({ prefs: users.notifyPrefs, email: users.email }).from(users).where(eq(users.id, p.uid)).limit(1)
  if (!u) return false
  // Почта аккаунта уже другая — письмо с этой ссылкой ушло на прежний адрес.
  if ((u.email ?? '').toLowerCase() !== p.em) return false
  // Гасим только почту: уведомления на сайте и в браузере — отдельные каналы,
  // отписка от рассылки не должна выключать их.
  await db
    .update(users)
    .set({ notifyPrefs: { ...u.prefs, email: false } })
    .where(eq(users.id, p.uid))
  return true
}
