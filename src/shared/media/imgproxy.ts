import 'server-only'
import { createHmac } from 'node:crypto'
import { getMediaSettings } from '@/shared/settings/media'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Подпись пути: HMAC-SHA256(key, salt || path), base64url без padding (как в imgproxy).
function signPath(path: string, keyHex: string, saltHex: string): string {
  const hmac = createHmac('sha256', Buffer.from(keyHex, 'hex'))
  hmac.update(Buffer.from(saltHex, 'hex'))
  hmac.update(path)
  return base64url(hmac.digest())
}

/**
 * Подписанный imgproxy-URL из storage_key.
 * options — процессинг (напр. rs:fill:160:160), ext — целевой формат.
 * Если imgproxy выключен — null (вызывающий покажет плейсхолдер).
 */
export async function imgproxyUrl(storageKey: string, options = 'rs:fill:160:160', ext = 'webp'): Promise<string | null> {
  const s = await getMediaSettings()
  if (!s.useImgproxy || !s.imgproxyUrl) return null
  const source = `s3://${s.s3Bucket}/${s.s3Prefix ? `${s.s3Prefix}/${storageKey}` : storageKey}`
  const encoded = base64url(source)
  const path = `/${options.replace(/^\/+|\/+$/g, '')}/${encoded}.${ext}`
  const base = s.cdnUrl || s.imgproxyUrl
  const sig = s.imgproxyKey && s.imgproxySalt ? signPath(path, s.imgproxyKey, s.imgproxySalt) : 'insecure'
  return `${base}/${sig}${path}`
}
