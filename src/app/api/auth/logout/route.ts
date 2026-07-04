import { NextResponse, type NextRequest } from 'next/server'
import { clearSessionCookie } from '@/shared/auth/session'
import { crossOriginBlock } from '@/shared/csrf'

export async function POST(req: NextRequest) {
  const blocked = crossOriginBlock(req)
  if (blocked) return blocked
  await clearSessionCookie()
  // Относительный Location — браузер резолвит к своему origin (за прокси req.url = 0.0.0.0:3000).
  return new NextResponse(null, { status: 303, headers: { Location: '/' } })
}
