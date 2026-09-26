import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isS3Configured } from '@/shared/settings/media'
import { IMAGE_MAX_BYTES, megabytes, type ImageRejection } from './limits'
import { deleteObject, putObject } from './s3'
import { sniffImage } from './sniff'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

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
 * client-provided mime игнорируется (защита от подмены). Возвращает ref:
 * S3 → storage_key (`{dir}/{uuid}.ext`); иначе диск → `/uploads/{dir}/{uuid}.ext`.
 */
export async function uploadImageFile(dir: string, file: File): Promise<string> {
  if (file.size > IMAGE_MAX_BYTES) throw new ImageRejectedError('too_big', `Файл больше ${megabytes(IMAGE_MAX_BYTES)} МБ.`)
  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffImage(buffer)
  const ext = mime ? EXT[mime] : undefined
  if (!ext) throw new ImageRejectedError('bad_type', 'Файл не похож на изображение (PNG, JPG, WEBP или GIF).')
  const name = `${randomUUID()}.${ext}`

  if (await isS3Configured()) {
    return putObject(`${dir}/${name}`, buffer, mime!)
  }
  const diskDir = join(process.cwd(), 'public', 'uploads', dir)
  await mkdir(diskDir, { recursive: true })
  await writeFile(join(diskDir, name), buffer)
  return `/uploads/${dir}/${name}`
}

/** Удаляет ранее загруженную картинку (S3 storage_key или /uploads-путь). */
export async function removeImageFile(ref: string | null | undefined): Promise<void> {
  if (!ref) return
  if (ref.startsWith('/uploads/')) {
    await unlink(join(process.cwd(), 'public', ref)).catch(() => {})
    return
  }
  if (await isS3Configured()) await deleteObject(ref, 'main').catch(() => {})
}
