// Общий финиш OAuth-входа (GitHub/Яндекс/VK): 2FA-развилка + старт сессии.
// Возвращает URL для редиректа.
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { startSession, type SessionUser } from '@/shared/auth/session'
import { takeNext } from './oauth-next'

export async function finishOauthLogin(session: SessionUser, appUrl: string): Promise<string> {
  // Включён 2FA — второй фактор обязателен и на OAuth-пути: сессию НЕ создаём,
  // ставим pending-куку и ведём на шаг с кодом.
  const [u] = await db
    .select({ totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)
  if (u?.totpEnabled) {
    const { startPendingLogin } = await import('./signed-cookies')
    await startPendingLogin(session.userId)
    // Цель поездки НЕ снимаем: её заберёт шаг второго фактора, когда вход завершится.
    return `${appUrl}/login/2fa`
  }
  await startSession(session)
  // ⚠️ ВОЗВРАЩАЕМ ТУДА, ОТКУДА ПРИШЛИ, а не на главную. Иначе человек, начавший
  // подключение MCP и вошедший через провайдера, оказывался на главной — и подключение
  // молча не состоялось (владелец, 02.09.2026: «сначала просто зашлось на сайт»).
  const next = await takeNext()
  return next ? `${appUrl}${next}` : appUrl
}
