import 'server-only'

/**
 * Реальный тип файла по сигнатуре (magic bytes), а НЕ по mime от клиента: тот пишет
 * кто угодно. Одно место на все пути загрузки — картинки (через приложение) и клипы
 * (напрямую в S3, проверка при финализации по первым байтам объекта).
 *
 * Сколько байт читать, чтобы узнать любой тип отсюда: см. `SNIFF_BYTES`.
 */
export const SNIFF_BYTES = 12 // самая длинная сигнатура — RIFF….WEBP и ….ftyp

export function sniffImage(b: Buffer): string | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function sniffVideo(b: Buffer): string | null {
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4' // ISO-BMFF (mp4/mov)
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm' // EBML
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') return 'video/ogg'
  return null
}
