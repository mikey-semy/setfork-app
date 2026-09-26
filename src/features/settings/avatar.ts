import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deleteByPrefix, isS3Configured, putObject } from '@/shared/media'
import { cleanImage } from '@/shared/media/clean-image'
import { AVATAR_MAX_BYTES, megabytes } from '@/shared/media/limits'

// Локальный фолбэк (public/uploads/avatars), если S3 не сконфигурирован.
const DISK_DIR = join(process.cwd(), 'public', 'uploads', 'avatars')
const DISK_PREFIX = '/uploads/avatars'

/**
 * Сохраняет аватар и возвращает ref для хранения в users.avatar_url:
 * - S3 сконфигурирован → storage_key (`avatars/{userId}/{uuid}.ext`);
 * - иначе → локальный путь (`/uploads/avatars/...`).
 * Бросает Error при ошибке валидации.
 */
export async function saveAvatar(userId: string, file: File): Promise<string> {
  if (file.size > AVATAR_MAX_BYTES) throw new Error(`Файл больше ${megabytes(AVATAR_MAX_BYTES)} МБ.`)
  // Тип — по сигнатуре, а не по `file.type`: его присылает клиент, и Safari после
  // кадрирования называл PNG «avatar.webp» (canvas не кодирует WebP). Метаданные
  // чистит та же функция, что у остальных картинок.
  const img = await cleanImage(Buffer.from(await file.arrayBuffer()))
  if (!img) throw new Error('Неподдерживаемый формат (нужен PNG, JPG, WEBP или GIF).')

  if (await isS3Configured()) {
    await deleteByPrefix(`avatars/${userId}/`).catch(() => {}) // убрать прошлые
    const key = `avatars/${userId}/${randomUUID()}.${img.ext}`
    return putObject(key, img.buffer, img.mime)
  }

  await mkdir(DISK_DIR, { recursive: true })
  await removeDiskAvatars(userId)
  const filename = `${userId}-${Date.now()}.${img.ext}`
  await writeFile(join(DISK_DIR, filename), img.buffer)
  return `${DISK_PREFIX}/${filename}`
}

/** Удаляет файлы аватара пользователя (S3 или диск) — best-effort. */
export async function removeAvatar(userId: string): Promise<void> {
  if (await isS3Configured()) {
    await deleteByPrefix(`avatars/${userId}/`).catch(() => {})
    return
  }
  await removeDiskAvatars(userId)
}

async function removeDiskAvatars(userId: string): Promise<void> {
  try {
    const files = await readdir(DISK_DIR)
    await Promise.all(
      files.filter((f) => f.startsWith(`${userId}-`)).map((f) => unlink(join(DISK_DIR, f)).catch(() => {})),
    )
  } catch {
    /* директории может не быть */
  }
}
