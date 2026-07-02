import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

// Настройки хранилища/картинок. Значения из БД (app_settings) перекрывают env;
// пустое поле в БД → берётся env. Секреты не отдаём на клиент (только маска).
export interface MediaSettings {
  s3Endpoint: string
  s3Region: string
  s3Bucket: string
  s3AccessKey: string
  s3SecretKey: string
  s3Prefix: string
  imgproxyUrl: string
  imgproxyKey: string
  imgproxySalt: string
  useImgproxy: boolean
  cdnUrl: string
}

export const MEDIA_KEYS = {
  s3Endpoint: 'media.s3_endpoint',
  s3Region: 'media.s3_region',
  s3Bucket: 'media.s3_bucket',
  s3AccessKey: 'media.s3_access_key',
  s3SecretKey: 'media.s3_secret_key',
  s3Prefix: 'media.s3_prefix',
  imgproxyUrl: 'media.imgproxy_url',
  imgproxyKey: 'media.imgproxy_key',
  imgproxySalt: 'media.imgproxy_salt',
  useImgproxy: 'media.use_imgproxy',
  cdnUrl: 'media.cdn_url',
} as const

// Ключи-секреты — на клиент уходит только маска, значение перезаписывается лишь при вводе.
export const MEDIA_SECRET_KEYS = [MEDIA_KEYS.s3SecretKey, MEDIA_KEYS.imgproxyKey, MEDIA_KEYS.imgproxySalt] as string[]

const strip = (s: string) => s.replace(/\/+$/, '')

let cache: MediaSettings | null = null
export function clearMediaCache(): void {
  cache = null
}

export async function getMediaSettings(): Promise<MediaSettings> {
  if (cache) return cache
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(MEDIA_KEYS)))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const val = (key: string, env: string) => (m[key]?.trim() || process.env[env] || '').trim()

  cache = {
    s3Endpoint: strip(val(MEDIA_KEYS.s3Endpoint, 'S3_ENDPOINT')),
    s3Region: val(MEDIA_KEYS.s3Region, 'S3_REGION') || 'us-east-1',
    s3Bucket: val(MEDIA_KEYS.s3Bucket, 'S3_BUCKET'),
    s3AccessKey: val(MEDIA_KEYS.s3AccessKey, 'S3_ACCESS_KEY'),
    s3SecretKey: val(MEDIA_KEYS.s3SecretKey, 'S3_SECRET_KEY'),
    s3Prefix: val(MEDIA_KEYS.s3Prefix, 'S3_PATH_PREFIX').replace(/^\/+|\/+$/g, ''),
    imgproxyUrl: strip(val(MEDIA_KEYS.imgproxyUrl, 'IMGPROXY_URL')),
    imgproxyKey: val(MEDIA_KEYS.imgproxyKey, 'IMGPROXY_KEY'),
    imgproxySalt: val(MEDIA_KEYS.imgproxySalt, 'IMGPROXY_SALT'),
    useImgproxy: (m[MEDIA_KEYS.useImgproxy] ?? (process.env.MEDIA_USE_IMGPROXY === 'true' ? 'true' : 'false')) === 'true',
    cdnUrl: strip(val(MEDIA_KEYS.cdnUrl, 'CDN_URL')),
  }
  return cache
}

export async function isS3Configured(): Promise<boolean> {
  const s = await getMediaSettings()
  return Boolean(s.s3Endpoint && s.s3Bucket && s.s3AccessKey && s.s3SecretKey)
}

/** «sk-…abcd» — для показа секрета в UI без раскрытия. */
export function maskSecret(v: string): string {
  if (!v) return ''
  if (v.length <= 8) return '•'.repeat(6)
  return `${v.slice(0, 4)}${'•'.repeat(8)}${v.slice(-4)}`
}
