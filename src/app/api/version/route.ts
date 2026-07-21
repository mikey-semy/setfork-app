import { NextResponse } from 'next/server'
import { getBuildId } from '@/shared/version'

// Иначе Next закеширует ответ в сборку — и «свежая версия» навсегда останется старой.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ build: getBuildId() }, { headers: { 'cache-control': 'no-store' } })
}
