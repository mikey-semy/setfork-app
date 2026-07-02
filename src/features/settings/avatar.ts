import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deleteByPrefix, isS3Configured, putObject } from '@/shared/media'

const MAX_BYTES = 2 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

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
  const ext = EXT[file.type]
  if (!ext) throw new Error('Неподдерживаемый формат (нужен PNG, JPG, WEBP или GIF).')
  if (file.size > MAX_BYTES) throw new Error('Файл больше 2 МБ.')
  const buffer = Buffer.from(await file.arrayBuffer())

  if (isS3Configured()) {
    await deleteByPrefix(`avatars/${userId}/`).catch(() => {}) // убрать прошлые
    const key = `avatars/${userId}/${randomUUID()}.${ext}`
    return putObject(key, buffer, file.type)
  }

  await mkdir(DISK_DIR, { recursive: true })
  await removeDiskAvatars(userId)
  const filename = `${userId}-${Date.now()}.${ext}`
  await writeFile(join(DISK_DIR, filename), buffer)
  return `${DISK_PREFIX}/${filename}`
}

/** Удаляет файлы аватара пользователя (S3 или диск) — best-effort. */
export async function removeAvatar(userId: string): Promise<void> {
  if (isS3Configured()) {
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
