// Уменьшение фото В БРАУЗЕРЕ перед отправкой. Фото с телефона — 12–48 Мп и 3–10 МБ,
// а показываем мы обложку баннером в сотни пикселей: слать оригинал значит упереться
// в предел картинки (IMAGE_MAX_BYTES) и мегабайты по мобильной сети ради того, что
// сервер всё равно ужмёт. Клиентский модуль: canvas, никакого node.

/** Длинная сторона после уменьшения. Обложку рисуем не шире 1280 CSS-пикселей
 *  (rs:fill:640:200 при плотности 2×), запас — на будущие места показа. */
export const SHRINK_MAX_SIDE = 1600

/** Качество JPEG: на фото без видимой разницы с оригиналом при кратно меньшем весе. */
const JPEG_QUALITY = 0.85

/** Размер после вписывания в квадрат `max`: пропорции сохраняются, увеличения нет. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Вернуть файл, пригодный к отправке: крупную картинку — вписанной в `SHRINK_MAX_SIDE`
 * и перекодированной в JPEG, остальное — как есть.
 *
 * Не трогаем: GIF (перекодирование убило бы анимацию) и то, что браузер не смог
 * декодировать, — тогда уходит оригинал, и формат/размер оценит сервер со своей
 * понятной причиной отказа. JPEG, а не WebP: Safari не кодирует canvas в WebP и
 * молча отдаёт PNG, который от фото весит больше исходника.
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
    // Уже маленькая и не тяжёлая — перекодирование только потеряет качество.
    if (size.width === bitmap.width && size.height === bitmap.height && file.type === 'image/jpeg') return file
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    // Перекодированный вышел тяжелее исходника (маленький PNG-рисунок) — шлём исходник.
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
