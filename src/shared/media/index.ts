import 'server-only'
import { imgproxyUrl } from './imgproxy'

export { isS3Configured, getMediaSettings } from '@/shared/settings/media'
export { deleteByPrefix, deleteObject, putObject } from './s3'
export { removeImageFile, uploadAttachmentFile, uploadImageFile, uploadVideoFile } from './upload'
export { imgproxyUrl }

/** Реф картинки → src для <img>. http(s)/data/uploads → как есть; иначе storage_key → imgproxy. */
export async function imageUrl(ref: string | null | undefined, options = 'rs:fit:1200:1200'): Promise<string | null> {
  if (!ref) return null
  if (/^(https?:|data:|\/)/i.test(ref)) return ref
  return imgproxyUrl(ref, options)
}

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
