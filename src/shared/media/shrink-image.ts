// Уменьшение фото В БРАУЗЕРЕ перед отправкой. Фото с телефона — 12–48 Мп и 3–10 МБ,
// а показываем мы обложку баннером в сотни пикселей: слать оригинал значит упереться
// в предел картинки (IMAGE_MAX_BYTES) и мегабайты по мобильной сети ради того, что
// сервер всё равно ужмёт. Клиентский модуль: canvas, никакого node.

/** Длинная сторона после уменьшения. Самое широкое превью обложки — `rs:fill:1200:400`
 *  на странице списка (queries/list.ts): 1200 ФИЗИЧЕСКИХ пикселей, то есть ~600 CSS
 *  при плотности 2×. 1600 — запас сверх него на будущие места показа. */
export const SHRINK_MAX_SIDE = 1600

/** Качество JPEG: на фото без видимой разницы с оригиналом при кратно меньшем весе. */
const JPEG_QUALITY = 0.85

/** Размер после вписывания в квадрат `max`: пропорции сохраняются, увеличения нет. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Вернуть файл, пригодный к отправке.
 *
 * - Уже влезает в `max` по длинной стороне — уходит КАК ЕСТЬ в любом формате:
 *   перекодирование только потеряло бы качество.
 * - Крупнее: JPEG → уменьшенный JPEG; PNG/WebP → уменьшенный PNG. Не JPEG, потому что
 *   у JPEG нет альфы, а прозрачное на canvas — прозрачно-чёрное: логотип на прозрачном
 *   фоне стал бы чёрным прямоугольником. Не WebP: Safari не кодирует canvas в WebP и
 *   молча отдаёт PNG.
 * - Уменьшенный вышел не легче исходника — уходит исходник.
 *
 * Не трогаем: GIF (перекодирование убило бы анимацию) и то, что браузер не смог
 * декодировать, — тогда уходит оригинал, и формат/размер оценит сервер со своей
 * понятной причиной отказа.
 */
export async function shrinkImage(file: File, max = SHRINK_MAX_SIDE): Promise<File> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap
  try {
    // Ориентацию из EXIF современные браузеры применяют при декодировании сами.
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, max)
    if (size.width === bitmap.width && size.height === bitmap.height) return file
    const jpeg = file.type === 'image/jpeg'
    const type = jpeg ? 'image/jpeg' : 'image/png'
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, size.width, size.height)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, jpeg ? JPEG_QUALITY : undefined),
      )
      if (!blob || blob.size >= file.size) return file
      const name = file.name.replace(/\.[^.]+$/, '') + (jpeg ? '.jpg' : '.png')
      return new File([blob], name, { type })
    } finally {
      // Холст 1600×1200 — ~7,5 МБ памяти; на телефоне Safari держит её до сборки
      // мусора и при нескольких попытках подряд отказывает в новом холсте.
      canvas.width = 0
      canvas.height = 0
    }
  } catch {
    // Сбой рисования/кодирования — не повод терять выбор человека: уходит оригинал.
    return file
  } finally {
    bitmap.close()
  }
}
