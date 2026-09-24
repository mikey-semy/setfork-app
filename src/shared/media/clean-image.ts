import 'server-only'
import sharp from 'sharp'
import { IMAGE_EXT, type ImageType } from './limits'

/**
 * Приём картинки на сервере — одно место на все входы: обложка, скриншот шага,
 * /api/upload, MCP и аватар (раньше аватар верил `file.type`, а остальные — сигнатуре).
 *
 * Здесь, а не в браузере, потому что клиентское уменьшение обходится: /api/upload,
 * MCP и сам экшен принимают оригинал как есть. Сервер — единственное место, мимо
 * которого снимок не пройдёт.
 */

/** Реальный тип картинки по сигнатуре (magic bytes), а НЕ по присланному mime. */
export function sniffImage(b: Buffer): ImageType | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Качество при вынужденном перекодировании (очистка метаданных). У sharp по
 *  умолчанию 80 — на фото это уже видимая потеря; 90 визуально неотличимо от
 *  исходника, а вес держит клиентское уменьшение ДО отправки (JPEG 0.85). */
const REENCODE_QUALITY = 90

export type CleanImage = { buffer: Buffer; mime: ImageType; ext: string }

/**
 * Картинка, годная к хранению: тип по сигнатуре + БЕЗ метаданных (EXIF/GPS/XMP/IPTC).
 * `null` — это не картинка из допустимых (сигнатура чужая или декодер её не понял);
 * причину отказа формулирует вызывающий.
 *
 * Зачем: фото с телефона несёт в EXIF координаты съёмки, модель устройства и время —
 * а картинки у нас публичные. Так делают все, у кого картинки видят чужие: Mastodon
 * (ImageMagick `+profile "!icc,*"`, app/models/media_attachment.rb), Discourse
 * (strip_image_metadata, lib/upload_creator.rb), Misskey (sharp,
 * packages/backend/src/core/DriveService.ts).
 *
 * - Метаданных нет — буфер уходит КАК ЕСТЬ: без перекодирования нет и потери
 *   качества (критерий Misskey: трогаем только то, что есть что чистить).
 * - Есть — `.autoOrient()` (поворот из EXIF переносится в пиксели: без тега браузер
 *   показал бы снимок боком) и перекодирование в ТОТ ЖЕ формат. sharp по умолчанию
 *   метаданные не пишет; ICC-профиль оставляем (`keepIccProfile`) — как Mastodon
 *   `!icc`: без него фото из P3-камеры iPhone тускнеет.
 * - GIF не трогаем: перекодирование потеряло бы анимацию. Сознательный остаток: EXIF
 *   в GIF не бывает, а XMP в блоке приложения пишут редакторы, не камеры телефонов.
 */
export async function cleanImage(input: Buffer): Promise<CleanImage | null> {
  const mime = sniffImage(input)
  if (!mime) return null
  const ext = IMAGE_EXT[mime]
  if (mime === 'image/gif') return { buffer: input, mime, ext }
  try {
    const meta = await sharp(input).metadata()
    if (!meta.exif && !meta.xmp && !meta.iptc) return { buffer: input, mime, ext }
    // Анимированный WebP перекодируем всеми кадрами: без `animated` sharp взял бы
    // первый. Поворот у анимации не применяем — камера такие не снимает.
    const animated = (meta.pages ?? 1) > 1
    const img = animated ? sharp(input, { animated }).keepIccProfile() : sharp(input).autoOrient().keepIccProfile()
    const out =
      mime === 'image/jpeg'
        ? img.jpeg({ quality: REENCODE_QUALITY })
        : mime === 'image/webp'
          ? img.webp({ quality: REENCODE_QUALITY })
          : img.png()
    return { buffer: await out.toBuffer(), mime, ext }
  } catch {
    // Сигнатура своя, а декодер не понял (битый файл, обрезанная загрузка). Хранить
    // нельзя: метаданные из такого файла не вычистить, и показать его всё равно нечем.
    return null
  }
}
