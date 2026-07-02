import 'server-only'
import { imgproxyUrl } from './imgproxy'

export { isS3Configured, getMediaSettings } from '@/shared/settings/media'
export { deleteByPrefix, putObject } from './s3'
export { imgproxyUrl }

/**
 * Аватар-реф → src для <img> (async, т.к. настройки медиа читаются из БД).
 * - http(s)/data/локальный /uploads → как есть (GitHub, dev-фолбэк на диск);
 * - иначе это storage_key в S3 → подписанный квадратный imgproxy-URL;
 * - null (нет аватара или imgproxy выключен) → компонент покажет identicon.
 */
export async function avatarSrc(ref: string | null | undefined, size = 160): Promise<string | null> {
  if (!ref) return null
  if (/^(https?:|data:|\/)/i.test(ref)) return ref
  return imgproxyUrl(ref, `rs:fill:${size}:${size}`)
}
