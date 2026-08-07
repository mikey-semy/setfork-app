'use client'

import { useState } from 'react'
import { toast } from '@/shared/ui/toast'
import { uploadStepFile, uploadStepImage, uploadStepVideo } from '../actions/uploads'
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
 * Куда лечь результату, знает таблица видов; сами экшены приходят параметром, чтобы
 * хук проверялся без поднятия серверных действий.
 */
export type Uploaders = {
  [K in DropKind]: (form: FormData) => Promise<{ error: string } | Partial<EditorItem>>
}

export const serverUploaders: Uploaders = {
  image: async (form) => {
    const res = await uploadStepImage(form)
    return 'error' in res ? res : { imageKey: res.key, imagePreview: res.url }
  },
  video: async (form) => {
    const res = await uploadStepVideo(form)
    return 'error' in res ? res : { videoUrl: res.url }
  },
  file: async (form) => {
    const res = await uploadStepFile(form)
    return 'error' in res ? res : { fileUrl: res.url, fileName: res.name }
  },
}

export function useBlockUploads(patchByUid: (uid: string, p: Partial<EditorItem>) => void, uploaders: Uploaders = serverUploaders) {
  const [running, setRunning] = useState<string[]>([])

  return {
    isBusy: (uid: string, kind: DropKind) => running.includes(`${uid}:${kind}`),
    upload: async (uid: string, kind: DropKind, file: File) => {
      const key = `${uid}:${kind}`
      setRunning((keys) => [...keys, key])
      const form = new FormData()
      form.append('file', file)
      const res = await uploaders[kind](form)
      if ('error' in res) toast.error(res.error)
      else patchByUid(uid, res)
      setRunning((keys) => keys.filter((k) => k !== key))
    },
  }
}
