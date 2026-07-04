import 'server-only'
import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '@/shared/db'
import { getVapid, pushEnabled } from './vapid'

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
}

/** Есть ли у пользователя хотя бы одна push-подписка. */
export async function userHasPush(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).limit(1)
  return Boolean(row)
}

/** Шлёт web-push на все подписки пользователя; мёртвые (404/410) удаляет. Best-effort. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!(await pushEnabled())) return
  const v = await getVapid()
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey)

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  if (subs.length === 0) return
  const data = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data)
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {})
        }
      }
    }),
  )
}
