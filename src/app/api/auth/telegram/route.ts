// Старт Telegram-входа (через бота, без виджета): одноразовый токен в БД +
// httpOnly-кука, дальше страница /login/telegram с t.me-ссылкой и поллингом.
import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { lt } from 'drizzle-orm'
import { db, telegramLoginTokens } from '@/shared/db'
import { oauthEnabled } from '@/shared/auth/oauth'

export async function GET() {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  if (!oauthEnabled().telegram) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_off`)
  }

  // Ленивая уборка: просроченные токены старше часа никому не нужны.
  await db.delete(telegramLoginTokens).where(lt(telegramLoginTokens.expiresAt, new Date(Date.now() - 3_600_000)))

  const token = randomBytes(16).toString('hex')
  await db.insert(telegramLoginTokens).values({ token, expiresAt: new Date(Date.now() + 600_000) })

  const c = await cookies()
  c.set('tg_login', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })
  return NextResponse.redirect(`${appUrl}/login/telegram`)
}
