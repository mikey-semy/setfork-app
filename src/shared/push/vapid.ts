import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'
import { SITE_HOST } from '@/shared/site'

// VAPID-ключи для Web Push (свой сервер, без сторонних сервисов). Значения из БД
// (app_settings, редактируются в админке) перекрывают env; ключи генерируются локально
// (web-push generateVAPIDKeys / `npx web-push generate-vapid-keys`).
export interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export const VAPID_KEYS = {
  public: 'push.vapid_public',
  private: 'push.vapid_private',
  subject: 'push.subject',
} as const

let cache: VapidConfig | null = null
export function clearVapidCache(): void {
  cache = null
}

export async function getVapid(): Promise<VapidConfig> {
  if (cache) return cache
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(VAPID_KEYS)))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const val = (key: string, env: string) => (m[key]?.trim() || process.env[env] || '').trim()
  cache = {
    publicKey: val(VAPID_KEYS.public, 'VAPID_PUBLIC_KEY'),
    privateKey: val(VAPID_KEYS.private, 'VAPID_PRIVATE_KEY'),
    subject: val(VAPID_KEYS.subject, 'VAPID_SUBJECT') || `mailto:admin@${SITE_HOST}`,
  }
  return cache
}

/** Настроен ли web-push (есть пара ключей). */
export async function pushEnabled(): Promise<boolean> {
  const v = await getVapid()
  return Boolean(v.publicKey && v.privateKey)
}
