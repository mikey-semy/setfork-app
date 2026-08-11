import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/shared/auth/app-origin'
import { applyUnsubscribe } from '@/shared/email/unsubscribe'

// Приёмник отписки из письма. Адрес этого роута едет в заголовке List-Unsubscribe.

const token = (req: NextRequest): string => new URL(req.url).searchParams.get('token') ?? ''

/** One-click (RFC 8058): почтовый клиент шлёт POST сам, человека здесь нет. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ok = await applyUnsubscribe(token(req))
  return new NextResponse(null, { status: ok ? 200 : 400 })
}

/**
 * Человек открыл ссылку в браузере. Молча НЕ отписываем: по GET-ссылкам ходят
 * антивирусы и предпросмотрщики почты — отписали бы того, кто письмо и не открыл.
 * Ведём на страницу с кнопкой.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return NextResponse.redirect(`${appOrigin()}/unsubscribe?token=${encodeURIComponent(token(req))}`)
}
