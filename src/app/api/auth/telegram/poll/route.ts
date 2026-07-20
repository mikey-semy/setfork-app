// Поллинг Telegram-входа: браузер с токеном в куке ждёт подтверждения в боте.
// Ответы: {pending} | {error:'expired'} | {url} — куда редиректить (сессия уже
// создана или 2FA-шаг). Токен одноразовый: по успеху строка удаляется.
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, telegramLoginTokens } from '@/shared/db'
import { upsertOauthUser } from '@/shared/auth/users'
import { finishOauthLogin } from '@/features/auth/oauth-finish'

export async function POST() {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  const c = await cookies()
  const token = c.get('tg_login')?.value
  if (!token) return NextResponse.json({ error: 'expired' })

  const [row] = await db.select().from(telegramLoginTokens).where(eq(telegramLoginTokens.token, token)).limit(1)
  if (!row || row.expiresAt < new Date()) {
    c.delete('tg_login')
    return NextResponse.json({ error: 'expired' })
  }
  if (!row.confirmedAt || !row.tgId) return NextResponse.json({ pending: true })

  // Подтверждено в боте → токен гасим и создаём/находим пользователя.
  await db.delete(telegramLoginTokens).where(eq(telegramLoginTokens.id, row.id))
  c.delete('tg_login')

  const session = await upsertOauthUser('telegram', {
    externalId: row.tgId,
    handleCandidates: [row.tgUsername, row.tgName, `tg${row.tgId}`],
    name: row.tgName,
    avatarUrl: null, // фото профиля тянуть через мост дорого; identicon-фолбэк
  })
  return NextResponse.json({ url: await finishOauthLogin(session, appUrl) })
}
