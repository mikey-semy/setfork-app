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

/**
 * Универсальная загрузка картинки. Возвращает ref для хранения в БД:
 * S3 → storage_key (`{dir}/{uuid}.ext`); иначе диск → `/uploads/{dir}/{uuid}.ext`.
 * Бросает Error при ошибке валидации.
 */
export async function uploadImageFile(dir: string, file: File): Promise<string> {
  const ext = EXT[file.type]
  if (!ext) throw new Error('Неподдерживаемый формат (PNG, JPG, WEBP или GIF).')
  if (file.size > MAX_BYTES) throw new Error('Файл больше 4 МБ.')
  const buffer = Buffer.from(await file.arrayBuffer())
  const name = `${randomUUID()}.${ext}`

  if (await isS3Configured()) {
    return putObject(`${dir}/${name}`, buffer, file.type)
  }
  const diskDir = join(process.cwd(), 'public', 'uploads', dir)
  await mkdir(diskDir, { recursive: true })
  await writeFile(join(diskDir, name), buffer)
  return `/uploads/${dir}/${name}`
}

const ATTACH_MAX_BYTES = 25 * 1024 * 1024 // 25 МБ на вложение
// Разрешённые расширения вложений (не-картинки). Исполняемое/скриптовое — не пускаем.
const ATTACH_EXT = new Set(['pdf', 'txt', 'md', 'csv', 'json', 'log', 'zip', 'gz', 'tar', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'svg'])

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
