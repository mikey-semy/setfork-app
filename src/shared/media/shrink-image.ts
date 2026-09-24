// Уменьшение фото В БРАУЗЕРЕ перед отправкой. Фото с телефона — 12–48 Мп и 3–10 МБ,
// а показываем мы обложку баннером в сотни пикселей: слать оригинал значит упереться
// в предел картинки (IMAGE_MAX_BYTES) и мегабайты по мобильной сети ради того, что
// сервер всё равно ужмёт. Клиентский модуль: canvas, никакого node.
//
// Метаданные (EXIF с GPS) здесь НЕ чистятся намеренно: уменьшение обходится (/api/upload,
// MCP, файл, что уже влез), поэтому чистит сервер — shared/media/clean-image.ts.

import { encodedFile } from './encoded-file'
import { IMAGE_MAX_BYTES } from './limits'

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
 * Размер картинки БЕЗ отрисовки и без раскодирования пикселей: <img> знает его из заголовка. По спеке
 * (WHATWG HTML naturalWidth + CSS `image-orientation: from-image` по умолчанию)
 * размер уже с учётом EXIF-ориентации — портретный снимок iPhone отдаёт 3024×4032.
 */
async function naturalSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    // Событие load, а не img.decode(): decode() обязан раскодировать пиксели целиком
    // (48 Мп в RGBA — ~190 МБ), а размеры известны уже после загрузки заголовка —
    // ровно то, от чего уходили, отказавшись от полноразмерного ImageBitmap.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image header not readable'))
      img.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Есть ли хоть один не вполне непрозрачный пиксель — как `hasTransparency` в
 *  медиа-оптимизации Discourse (codecs.js). */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Вернуть файл, пригодный к отправке. НЕ бросает никогда: любой сбой — оригинал.
 *
 * - Уже влезает в `max` по длинной стороне — уходит КАК ЕСТЬ в любом формате:
 *   перекодирование только потеряло бы качество.
 * - Крупнее: полноразмерную картинку в память не берём — размер узнаём у <img>, а
 *   декодер сразу отдаёт уменьшенную (`createImageBitmap` с `resizeWidth` или
 *   `resizeHeight`; Safari 15+, Chrome 54+, Firefox 98+). 48 Мп в RGBA — ~190 МБ,
 *   на телефоне это отказ вкладки. Ориентацию из EXIF декодер применяет сам
 *   (`imageOrientation` по умолчанию `from-image`, WHATWG).
 * - JPEG → уменьшенный JPEG.
 * - PNG/WebP → уменьшенный PNG: у JPEG нет альфы, а прозрачное на canvas —
 *   прозрачно-чёрное, логотип стал бы чёрным прямоугольником; WebP Safari не кодирует.
 *   Если PNG всё равно больше предела и прозрачных пикселей нет — JPEG. Отклонение
 *   от Discourse: там непрозрачное сразу идёт в JPEG; у нас PNG в приоритете, потому
 *   что PNG крупнее 1600px — чаще скриншот с текстом, а JPEG мылит буквы.
 * - Уменьшенный вышел не легче исходника — уходит исходник.
 *
 * Не трогаем: GIF (перекодирование убило бы анимацию) и то, что браузер не смог
 * декодировать, — тогда уходит оригинал, и формат/размер оценит сервер со своей
 * понятной причиной отказа.
 */
export async function shrinkImage(file: File, max = SHRINK_MAX_SIDE): Promise<File> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap | null = null
  const canvas = document.createElement('canvas')
  try {
    const natural = await naturalSize(file)
    const size = fitWithin(natural.width, natural.height, max)
    if (size.width === natural.width && size.height === natural.height) return file
    // Одна сторона — вторую декодер выводит из пропорций сам (спека createImageBitmap).
    // `resizeQuality` Firefox понимает с 149; без него берёт 'low' — это приемлемо.
    const side = natural.width >= natural.height ? { resizeWidth: size.width } : { resizeHeight: size.height }
    bitmap = await createImageBitmap(file, { ...side, resizeQuality: 'high' })
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0)

    let blob: Blob | null
    if (file.type === 'image/jpeg') {
      blob = await encode(canvas, 'image/jpeg', JPEG_QUALITY)
    } else {
      blob = await encode(canvas, 'image/png')
      if (blob && blob.size > IMAGE_MAX_BYTES && !hasTransparency(ctx, canvas.width, canvas.height)) {
        blob = await encode(canvas, 'image/jpeg', JPEG_QUALITY)
      }
    }
    if (!blob || blob.size >= file.size) return file
    return encodedFile(blob, file.name.replace(/\.[^.]+$/, ''))
  } catch {
    // Сбой декодирования/рисования/кодирования — не повод терять выбор человека:
    // уходит оригинал.
    return file
  } finally {
    // Холст 1600×1200 — ~7,5 МБ памяти; на телефоне Safari держит её до сборки
    // мусора и при нескольких попытках подряд отказывает в новом холсте.
    canvas.width = 0
    canvas.height = 0
    try {
      bitmap?.close()
    } catch {
      // Освобождение не удалось — память вернёт сборщик; файл уже решён выше.
    }
  }
}
