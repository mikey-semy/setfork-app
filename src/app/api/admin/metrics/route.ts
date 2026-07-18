import { NextResponse } from 'next/server'
import { getAdmin } from '@/shared/auth/admin'
import { getLiveMetrics } from '@/features/admin/dashboard-queries'

/**
 * Живой снимок дашборда. Дашборд поллит его каждые ~15с (SSE/вебсокетов в проекте нет — паттерн
 * лёгкого поллинга как у /api/generate/[id]/live). Явный 401 вместо редиректа: цель — fetch, не навигация.
 */
export async function GET() {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const metrics = await getLiveMetrics()
  return NextResponse.json(metrics, { headers: { 'cache-control': 'no-store' } })
}
