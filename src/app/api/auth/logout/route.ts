import { NextResponse, type NextRequest } from 'next/server'
import { clearSessionCookie } from '@/shared/auth/session'

export async function POST(req: NextRequest) {
  await clearSessionCookie()
  return NextResponse.redirect(new URL('/', req.url), { status: 303 })
}
