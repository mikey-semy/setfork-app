'use client'

import { useState } from 'react'
import { toast } from '@/shared/ui/toast'
import { t, type Lang } from '@/shared/i18n'
import { isRetryableUpload, uploadErrorText, uploadFile } from '@/shared/media/upload-client'
import type { UploadKind } from '@/shared/media/limits'
import { uploadStepImage } from '../actions/uploads'
import type { EditorItem } from '../editor'
import type { DropKind } from './FileDrop'

/**
 * Загрузка файла в блок: скриншот, свой видеоклип, вложение.
 *
 * Занятость помечается ключом `блок:вид`, а не одним значением: пока летит видео,
 * можно перетащить картинку в другой блок — и обе полосы «Загрузка…» должны стоять
 * до своего конца.
 *
 * Блок адресуется СТАБИЛЬНЫМ id, а не номером в списке. Файл возвращается через
 * секунды, и за это время блок можно переставить или удалить: по номеру полоса
 * «Загрузка…» повисала бы на чужой карточке, а результат ложился бы в чужой блок.
 *
 * Куда лечь результату, знает таблица видов; загрузчики приходят параметром, чтобы
 * хук проверялся без поднятия серверных действий и хранилища.
 *
 * Скриншот (≤4 МБ) идёт server action'ом через приложение (imgproxy). Вложение и клип
 * — НАПРЯМУЮ в S3 (`shared/media/upload-client`): через server action не проходит
 * тело больше 1 МБ, а диск контейнера на проде не переживает выкатку.
 */
/** Отказ загрузчика: готовый текст и есть ли смысл повторять тот же файл. */
export type UploadFailure = { error: string; retry?: boolean }

export type Uploaders = {
  [K in DropKind]: (file: File, lang: Lang) => Promise<UploadFailure | Partial<EditorItem>>
}

/** Прямая загрузка в S3 → поля блока; отказ → текст причины на языке человека. */
function direct(kind: UploadKind, toItem: (res: { url: string; name: string }) => Partial<EditorItem>) {
  return async (file: File, lang: Lang): Promise<UploadFailure | Partial<EditorItem>> => {
    const res = await uploadFile(kind, file)
    if ('error' in res) return { error: uploadErrorText(res.error, kind, lang), retry: isRetryableUpload(res.error) }
    return toItem(res)
  }
}

export const serverUploaders: Uploaders = {
  image: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await uploadStepImage(form)
    return 'error' in res ? res : { imageKey: res.key, imagePreview: res.url }
  },
  video: direct('video', (res) => ({ videoUrl: res.url })),
  file: direct('file', (res) => ({ fileUrl: res.url, fileName: res.name })),
}

export function useBlockUploads(
  patchByUid: (uid: string, p: Partial<EditorItem>) => void,
  lang: Lang,
  uploaders: Uploaders = serverUploaders,
) {
  const [running, setRunning] = useState<string[]>([])

  async function upload(uid: string, kind: DropKind, file: File): Promise<void> {
    const key = `${uid}:${kind}`
    setRunning((keys) => [...keys, key])
    const again = { action: { label: t('tryAgain', lang), onClick: () => void upload(uid, kind, file) } }
    try {
      const res = await uploaders[kind](file, lang)
      if (!('error' in res)) patchByUid(uid, res)
      else if (res.retry) toast.error(res.error, again)
      // Сам файл не годится (размер, тип) или хранилища нет — повтор дал бы тот же отказ.
      else toast.error(res.error)
    } catch {
      // Отклонённый экшен — обычный исход, а не исключительный: тело больше предела
      // server action, обрыв связи, 500 из рендера. Без catch полоса «Загрузка…»
      // висела вечно, а человек не узнавал ничего (ревью по линзам #974).
      toast.error(t('editor.uploadRejected', lang), again)
    } finally {
      setRunning((keys) => keys.filter((k) => k !== key))
    }
  }

  return {
    isBusy: (uid: string, kind: DropKind) => running.includes(`${uid}:${kind}`),
    upload,
  }
}
