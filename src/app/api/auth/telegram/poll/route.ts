// Поллинг Telegram-входа: браузер с токеном в куке ждёт подтверждения в боте.
// Ответы: {pending} | {needCode[,badCode]} | {error:'expired'} | {url}. Токен
// одноразовый: по успеху строка удаляется.
//
// Завершение входа требует КОДА, который бот прислал подтвердившему в Telegram
// (telegramLoginCode). Это привязывает завершение к браузеру-инициатору: relay чужой
// t.me-ссылки жертве не даёт атакующему сессию — код уходит жертве в TG, а ввести его
// нужно в браузере с токеном (F2, CWE-352).
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, telegramLoginTokens } from '@/shared/db'
import { upsertOauthUser } from '@/shared/auth/users'
import { finishOauthLogin } from '@/features/auth/oauth-finish'
import { rateLimit } from '@/shared/rate-limit'
import { telegramLoginCode } from '@/shared/telegram'

export async function POST(req: Request) {
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

  // Статус-поллинг (без кода) → просим ввести код. Тело парсим мягко: обычный тик поллера
  // шлёт POST без тела.
  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
  if (!code) return NextResponse.json({ needCode: true })

  // Брутфорс кода: 5 попыток на токен за окно жизни (код 6 цифр → шанс подбора ничтожен).
  // Исчерпал — гасим токен, вход начинается заново.
  if (!(await rateLimit(`tglogin-code:${token}`, 5, 600_000)).ok) {
    await db.delete(telegramLoginTokens).where(eq(telegramLoginTokens.id, row.id))
    c.delete('tg_login')
    return NextResponse.json({ error: 'expired' })
  }
  if (code !== telegramLoginCode(token, row.tgId)) return NextResponse.json({ needCode: true, badCode: true })

  // Код верный → токен гасим и создаём/находим пользователя.
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
