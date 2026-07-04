import { NextResponse } from 'next/server'
import { getVapid } from '@/shared/push/vapid'

/** Публичный VAPID-ключ для подписки на push в браузере. */
export async function GET() {
  const v = await getVapid()
  return NextResponse.json({ publicKey: v.publicKey })
}
