// Dev-фолбэк: вход как общий demo-пользователь (когда нет GitHub OAuth-приложения).
import { NextResponse, type NextRequest } from 'next/server'
import { getOrCreateDemoUser } from '@/shared/auth/users'
import { startSession } from '@/shared/auth/session'
import { crossOriginBlock } from '@/shared/csrf'

export async function POST(req: NextRequest) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  const session = await getOrCreateDemoUser()
  await startSession(session)
  return NextResponse.redirect(new URL('/', req.url), { status: 303 })
}
