'use server'

import { requireSession } from '@/shared/auth/session'
import { imageUrl, uploadAttachmentFile, uploadImageFile, uploadVideoFile } from '@/shared/media'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

/**
 * Загрузка файлов редактора: скриншот шага, свой видеоклип, вложение.
 *
 * Отдельно от остальных экшенов библиотеки: у загрузок своя причина меняться —
 * хранилище и правила приёма файлов, — и они единственные, кто ходит в `shared/media`.
 *
 * Ответ отдаётся уже готовой строкой ошибки: у экшена нет способа вернуть ключ так,
 * чтобы клиент его перевёл, — форма показывает то, что пришло. Поэтому язык берём из
 * профиля, а не из захардкоженного русского, как было до разбора.
 */
async function failure(e: unknown): Promise<{ error: string }> {
  const lang = await getLang()
  return { error: e instanceof Error ? e.message : t('loadFailed', lang) }
}

async function pickFile(formData: FormData): Promise<File | { error: string }> {
  const file = formData.get('file')
  if (file instanceof File && file.size > 0) return file
  return { error: t('noFileChosen', await getLang()) }
}

/** Скриншот шага: кладём в хранилище и отдаём ключ + превью-URL для редактора. */
export async function uploadStepImage(formData: FormData): Promise<{ key: string; url: string } | { error: string }> {
  const session = await requireSession()
  const file = await pickFile(formData)
  if ('error' in file) return file
  try {
    const key = await uploadImageFile(`steps/${session.userId}`, file)
    return { key, url: (await imageUrl(key, 'rs:fit:960:960')) ?? '' }
  } catch (e) {
    return failure(e)
  }
}

/** Свой видеофайл (video-блок) → путь /uploads/videos/... для <video>. */
export async function uploadStepVideo(formData: FormData): Promise<{ url: string } | { error: string }> {
  const session = await requireSession()
  const file = await pickFile(formData)
  if ('error' in file) return file
  try {
    return { url: await uploadVideoFile(`videos/${session.userId}`, file) }
  } catch (e) {
    return failure(e)
  }
}

/** Вложение (file-блок): PDF/архив/… → путь /uploads/files/... и имя файла. */
export async function uploadStepFile(formData: FormData): Promise<{ url: string; name: string } | { error: string }> {
  await requireSession()
  const file = await pickFile(formData)
  if ('error' in file) return file
  try {
    return await uploadAttachmentFile(file)
  } catch (e) {
    return failure(e)
  }
}
