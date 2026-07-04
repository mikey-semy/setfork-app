import { NextResponse, type NextRequest } from 'next/server'
import { clearSessionCookie } from '@/shared/auth/session'
import { crossOriginBlock } from '@/shared/csrf'

export async function POST(req: NextRequest) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  await clearSessionCookie()
  return NextResponse.redirect(new URL('/', req.url), { status: 303 })
}
