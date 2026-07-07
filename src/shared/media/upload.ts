import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isS3Configured } from '@/shared/settings/media'
import { deleteObject, putObject } from './s3'

const MAX_BYTES = 4 * 1024 * 1024 // 4 МБ для скриншотов
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Реальный тип картинки по сигнатуре (magic bytes), а НЕ по client-provided mime. */
function sniffImage(b: Buffer): string | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * Универсальная загрузка картинки. Тип определяется по СОДЕРЖИМОМУ (magic bytes),
 * client-provided mime игнорируется (защита от подмены). Возвращает ref:
 * S3 → storage_key (`{dir}/{uuid}.ext`); иначе диск → `/uploads/{dir}/{uuid}.ext`.
 */
export async function uploadImageFile(dir: string, file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('Файл больше 4 МБ.')
  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffImage(buffer)
  const ext = mime ? EXT[mime] : undefined
  if (!ext) throw new Error('Файл не похож на изображение (PNG, JPG, WEBP или GIF).')
  const name = `${randomUUID()}.${ext}`

  if (await isS3Configured()) {
    return putObject(`${dir}/${name}`, buffer, mime!)
  }
  const diskDir = join(process.cwd(), 'public', 'uploads', dir)
  await mkdir(diskDir, { recursive: true })
  await writeFile(join(diskDir, name), buffer)
  return `/uploads/${dir}/${name}`
}

const VIDEO_MAX_BYTES = 50 * 1024 * 1024 // 50 МБ на клип (без транскодинга; часовые лекции — Cloudflare Stream позже)
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
  if (file.size > VIDEO_MAX_BYTES) throw new Error('Файл больше 50 МБ.')
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

const ATTACH_MAX_BYTES = 25 * 1024 * 1024 // 25 МБ на вложение
// Разрешённые расширения вложений (не-картинки). Исполняемое/скриптовое — не пускаем.
// SVG НАМЕРЕННО исключён: файл отдаётся инлайн с того же origin, а `<script>` внутри SVG
// → хранимый XSS. Векторные картинки не нужны для чек-листов.
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
  if (file.size > ATTACH_MAX_BYTES) throw new Error('Файл больше 25 МБ.')
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
