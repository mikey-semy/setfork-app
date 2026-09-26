import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isS3Configured } from '@/shared/settings/media'
import { ATTACH_MAX_BYTES, IMAGE_MAX_BYTES, megabytes, VIDEO_MAX_BYTES, type ImageRejection } from './limits'
import { cleanImage } from './clean-image'
import { deleteObject, putObject } from './s3'

/** Отказ по самому файлу (размер/формат), а не сбой хранилища. `reason` — код для
 *  интерфейса: экшен не может вернуть переводимую строку, а клиент переводит код сам.
 *  Текст сообщения прежний — его показывают редактор и /api/upload. */
export class ImageRejectedError extends Error {
  constructor(
    readonly reason: ImageRejection,
    message: string,
  ) {
    super(message)
    this.name = 'ImageRejectedError'
  }
}

/**
 * Универсальная загрузка картинки. Тип определяется по СОДЕРЖИМОМУ (magic bytes),
 * client-provided mime игнорируется (защита от подмены); метаданные (EXIF с GPS и
 * пр.) вычищаются — см. cleanImage. Возвращает ref:
 * S3 → storage_key (`{dir}/{uuid}.ext`); иначе диск → `/uploads/{dir}/{uuid}.ext`.
 */
export async function uploadImageFile(dir: string, file: File): Promise<string> {
  if (file.size > IMAGE_MAX_BYTES) throw new ImageRejectedError('too_big', `Файл больше ${megabytes(IMAGE_MAX_BYTES)} МБ.`)
  const img = await cleanImage(Buffer.from(await file.arrayBuffer()))
  if (!img) throw new ImageRejectedError('bad_type', 'Файл не похож на изображение (PNG, JPG, WEBP или GIF).')
  const name = `${randomUUID()}.${img.ext}`

  if (await isS3Configured()) {
    return putObject(`${dir}/${name}`, img.buffer, img.mime)
  }
  const diskDir = join(process.cwd(), 'public', 'uploads', dir)
  await mkdir(diskDir, { recursive: true })
  await writeFile(join(diskDir, name), img.buffer)
  return `/uploads/${dir}/${name}`
}

const VIDEO_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv' }
/** Тип видео по сигнатуре (magic bytes), НЕ по client-mime. */
function sniffVideo(b: Buffer): string | null {
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4' // ISO-BMFF (mp4/mov)
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm' // EBML
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') return 'video/ogg'
  return null
}

/** Загрузка видео-файла (свой клип) на диск (`/uploads/videos/...`), отдаётся <video>.
 *  Тип — по содержимому. Всегда диск (S3-стриминг видео = отдельный роут/Cloudflare). */
export async function uploadVideoFile(dir: string, file: File): Promise<string> {
  if (file.size > VIDEO_MAX_BYTES) throw new Error(`Файл больше ${megabytes(VIDEO_MAX_BYTES)} МБ.`)
  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffVideo(buffer)
  const ext = mime ? VIDEO_EXT[mime] : undefined
  if (!ext) throw new Error('Файл не похож на видео (MP4, WEBM или OGG).')
  const name = `${randomUUID()}.${ext}`
  const diskDir = join(process.cwd(), 'public', 'uploads', dir)
  await mkdir(diskDir, { recursive: true })
  await writeFile(join(diskDir, name), buffer)
  return `/uploads/${dir}/${name}`
}

// Разрешённые расширения вложений (не-картинки). Исполняемое/скриптовое — не пускаем.
// SVG НАМЕРЕННО исключён: файл отдаётся инлайн с того же origin, а `<script>` внутри SVG
// → хранимый XSS. Векторные картинки не нужны для списков.
const ATTACH_EXT = new Set(['pdf', 'txt', 'md', 'csv', 'json', 'log', 'zip', 'gz', 'tar', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])

/**
 * Загрузка произвольного вложения (не-картинки) на диск (`/uploads/files/...`).
 * Картинки грузить через uploadImageFile. Возвращает публичный путь + имя.
 * NB: всегда диск — для S3-прода вложения нужен отдельный download-роут (пока не нужно).
 */
export async function uploadAttachmentFile(file: File): Promise<{ url: string; name: string }> {
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  if (!ATTACH_EXT.has(ext)) throw new Error(`Тип .${ext || '?'} не разрешён для вложения.`)
  if (file.size > ATTACH_MAX_BYTES) throw new Error(`Файл больше ${megabytes(ATTACH_MAX_BYTES)} МБ.`)
  const buffer = Buffer.from(await file.arrayBuffer())
  const stored = `${randomUUID()}.${ext}`
  const diskDir = join(process.cwd(), 'public', 'uploads', 'files')
  await mkdir(diskDir, { recursive: true })
  await writeFile(join(diskDir, stored), buffer)
  return { url: `/uploads/files/${stored}`, name: file.name }
}

/** Удаляет ранее загруженную картинку (S3 storage_key или /uploads-путь). */
export async function removeImageFile(ref: string | null | undefined): Promise<void> {
  if (!ref) return
  if (ref.startsWith('/uploads/')) {
    await unlink(join(process.cwd(), 'public', ref)).catch(() => {})
    return
  }
  if (await isS3Configured()) await deleteObject(ref).catch(() => {})
}
