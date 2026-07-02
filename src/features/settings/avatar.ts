import 'server-only'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Аватары храним локально в public/uploads/avatars — Next отдаёт их статикой.
// Для serverless-деплоя позже заменить на облачное хранилище (S3 / Vercel Blob).
const DIR = join(process.cwd(), 'public', 'uploads', 'avatars')
const PUBLIC_PREFIX = '/uploads/avatars'
const MAX_BYTES = 2 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Сохраняет загруженный файл, возвращает публичный URL. Бросает Error при ошибке валидации. */
export async function saveAvatarFile(userId: string, file: File): Promise<string> {
  const ext = EXT[file.type]
  if (!ext) throw new Error('Неподдерживаемый формат (нужен PNG, JPG, WEBP или GIF).')
  if (file.size > MAX_BYTES) throw new Error('Файл больше 2 МБ.')

  await mkdir(DIR, { recursive: true })
  await removeAvatarFiles(userId) // убрать прошлый аватар (любое расширение)

  const stamp = Date.now() // busting кэша: имя меняется при каждой загрузке
  const filename = `${userId}-${stamp}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(join(DIR, filename), buffer)
  return `${PUBLIC_PREFIX}/${filename}`
}

/** Удаляет все файлы аватара пользователя (best-effort). */
export async function removeAvatarFiles(userId: string): Promise<void> {
  try {
    const files = await readdir(DIR)
    await Promise.all(
      files.filter((f) => f.startsWith(`${userId}-`) || f.startsWith(`${userId}.`)).map((f) => unlink(join(DIR, f)).catch(() => {})),
    )
  } catch {
    // директории может не быть — это норм
  }
}
