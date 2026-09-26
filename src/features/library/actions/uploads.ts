'use server'

import { requireSession } from '@/shared/auth/session'
import { imageUrl, uploadImageFile } from '@/shared/media'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

/**
 * Загрузка скриншота шага через приложение (≤4 МБ, S3 → imgproxy или диск).
 *
 * Вложение и свой видеоклип сюда больше не ходят: у server action предел тела 1 МБ,
 * а диск контейнера не переживает выкатку — они грузятся напрямую в S3
 * (`shared/media/direct-upload` + `upload-client`).
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
