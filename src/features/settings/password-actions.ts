'use server'

import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, sessions, users } from '@/shared/db'
import { hashPassword, verifyPassword } from '@/shared/auth/password'
import { requireSession } from '@/shared/auth/session'
import { clientIpFromHeaders } from '@/shared/auth/app-origin'
import { rateLimit } from '@/shared/rate-limit'
import { recordAudit } from '@/shared/audit'
import { MIN_PASSWORD_LENGTH } from '@/shared/auth/password-policy'
import type { TKey } from '@/shared/i18n'

/**
 * ЗАДАТЬ ИЛИ СМЕНИТЬ ПАРОЛЬ В НАСТРОЙКАХ.
 *
 * ⚠️ ЭТО НЕ УДОБСТВО, А ЗАПАСНОЙ ВЫХОД. Вошедший через внешнего провайдера пароля не
 * имеет вовсе, и другого способа войти у него обычно нет. Владелец назвал сценарий
 * прямо (02.09.2026): «может случиться так, что аккаунта в GitHub или Telegram может не
 * стать. Что тогда?» Тогда — ничего: восстановление по почте меняет пароль, которого
 * никогда не было, а войти, чтобы его завести, уже нечем. Дверь закрыта снаружи.
 *
 * Поэтому здесь ДВА режима одной формы:
 *  • пароля нет — задать, подтверждения старым паролем не спрашиваем (его нет);
 *  • пароль есть — сменить, старый обязателен.
 *
 * Форма из GitHub (Settings → Password): текущий пароль, новый, и выход со всех
 * устройств кроме текущего после смены.
 */
export type PasswordState = { ok?: true; error?: TKey } | null

export async function setPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const session = await requireSession()
  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('password') ?? '')

  // Подбор старого пароля здесь так же возможен, как на странице входа, и цена его выше:
  // угадавший меняет пароль и запирает хозяина снаружи.
  const ip = await clientIpFromHeaders()
  const [byUser, byIp] = await Promise.all([
    rateLimit(`setpw:user:${session.userId}`, 10, 15 * 60_000),
    rateLimit(`setpw:ip:${ip}`, 20, 15 * 60_000),
  ])
  if (!byUser.ok || !byIp.ok) return { error: 'auth.password.throttled' }

  if (next.length < MIN_PASSWORD_LENGTH) return { error: 'passwordShort' }

  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, session.userId)).limit(1)
  if (!u) return { error: 'auth.password.failed' }

  // Пароль уже есть — меняем только со старым на руках: сессию могли увести, и без
  // подтверждения угонщик менял бы пароль в один клик, отрезая хозяина.
  if (u.hash && !verifyPassword(current, u.hash)) return { error: 'auth.password.wrongCurrent' }

  await db.update(users).set({ passwordHash: hashPassword(next) }).where(eq(users.id, session.userId))

  // ⚠️ Выходим со всех устройств, КРОМЕ текущего. Так у GitHub: смена пароля — обычная
  // реакция на «кажется, меня взломали», и она обязана выбрасывать чужую сессию. Свою
  // при этом рвать нельзя: человек оказался бы на странице входа с новым паролем и
  // решил, что смена не удалась.
  // `sid` у сессии необязателен (старые cookie его не носили): без него отзываем ВСЕ,
  // включая свою — лучше повторный вход, чем оставленная живой чужая сессия.
  await db
    .delete(sessions)
    .where(session.sid ? and(eq(sessions.userId, session.userId), ne(sessions.id, session.sid))! : eq(sessions.userId, session.userId))

  await recordAudit(u.hash ? 'password.change' : 'password.set', { actorId: session.userId })
  revalidatePath('/settings')
  return { ok: true }
}
