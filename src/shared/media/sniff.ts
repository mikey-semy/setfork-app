import 'server-only'
import type { ImageType } from './limits'

/**
 * Реальный тип файла по сигнатуре (magic bytes), а НЕ по mime от клиента: тот пишет
 * кто угодно. Одно место на все пути загрузки (картинки через приложение — clean-image;
 * аватар; дальше — клипы прямой загрузки).
 */
/** Реальный тип картинки по сигнатуре (magic bytes), а НЕ по присланному mime. */
export function sniffImage(b: Buffer): ImageType | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}
