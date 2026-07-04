import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/shared/auth/session'
import { db, pushSubscriptions } from '@/shared/db'

/** Сохранить push-подписку текущего пользователя (upsert по endpoint). */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sub = await req.json().catch(() => null)
  const endpoint: string | undefined = sub?.endpoint
  const p256dh: string | undefined = sub?.keys?.p256dh
  const auth: string | undefined = sub?.keys?.auth
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: 'bad_subscription' }, { status: 400 })
  await db
    .insert(pushSubscriptions)
    .values({ userId: session.userId, endpoint, p256dh, auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: session.userId, p256dh, auth } })
  return NextResponse.json({ ok: true })
}

/** Удалить подписку (по endpoint) — при выключении браузерных уведомлений. */
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const endpoint: string | undefined = body?.endpoint
  if (endpoint) {
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, session.userId)))
  }
  return NextResponse.json({ ok: true })
}
