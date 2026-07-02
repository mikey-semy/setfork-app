import 'server-only'
import { createHmac } from 'node:crypto'
import { mediaConfig } from './config'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Подпись пути: HMAC-SHA256(key, salt || path), base64url без padding (как в imgproxy).
function signPath(path: string): string {
  const { key, salt } = mediaConfig.imgproxy
  const hmac = createHmac('sha256', Buffer.from(key, 'hex'))
  hmac.update(Buffer.from(salt, 'hex'))
  hmac.update(path)
  return base64url(hmac.digest())
}

function s3Source(storageKey: string): string {
  const { bucket, prefix } = mediaConfig.s3
  const key = prefix ? `${prefix}/${storageKey}` : storageKey
  return `s3://${bucket}/${key}`
}

/**
 * Подписанный imgproxy-URL из storage_key.
 * options — процессинг (напр. rs:fill:160:160), ext — целевой формат.
 * Если imgproxy выключен — null (вызывающий покажет плейсхолдер).
 */
export function imgproxyUrl(storageKey: string, options = 'rs:fill:160:160', ext = 'webp'): string | null {
  const { url, key, salt, enabled } = mediaConfig.imgproxy
  if (!enabled || !url) return null
  const encoded = base64url(s3Source(storageKey))
  const path = `/${options.replace(/^\/+|\/+$/g, '')}/${encoded}.${ext}`
  const base = mediaConfig.cdnUrl || url
  const sig = key && salt ? signPath(path) : 'insecure'
  return `${base}/${sig}${path}`
}
