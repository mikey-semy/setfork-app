'use client'

import { useState } from 'react'
import { toast } from '@/shared/ui/toast'
import { uploadStepFile, uploadStepImage, uploadStepVideo } from '../actions'
import type { EditorItem } from '../editor'
import type { DropKind } from './FileDrop'

/**
 * Загрузка файла в блок: скриншот, свой видеоклип, вложение.
 *
 * Занятость помечается ключом `блок:вид`, а не одним значением: пока летит видео,
 * можно перетащить картинку в другой блок — и обе полосы «Загрузка…» должны стоять
 * до своего конца. Что делать с ответом, знает только вызывающая сторона — сюда
 * приходит `patch`, которым результат ложится в поля блока.
 */
export function useBlockUploads(patch: (i: number, p: Partial<EditorItem>) => void) {
  const [running, setRunning] = useState<string[]>([])

  const isBusy = (i: number, kind: DropKind) => running.includes(`${i}:${kind}`)

  async function upload(i: number, kind: DropKind, file: File) {
    const key = `${i}:${kind}`
    setRunning((keys) => [...keys, key])
    const form = new FormData()
    form.append('file', file)
    // Ветки различаются экшеном и полями, куда лечь результату. Общий разбор одним
    // union не пишется: сужение по свойству даёт `unknown` на трёх разных исходах.
    if (kind === 'image') {
      const res = await uploadStepImage(form)
      if ('error' in res) toast.error(res.error)
      else patch(i, { imageKey: res.key, imagePreview: res.url })
    } else if (kind === 'video') {
      const res = await uploadStepVideo(form)
      if ('error' in res) toast.error(res.error)
      else patch(i, { videoUrl: res.url })
    } else {
      const res = await uploadStepFile(form)
      if ('error' in res) toast.error(res.error)
      else patch(i, { fileUrl: res.url, fileName: res.name })
    }
    setRunning((keys) => keys.filter((k) => k !== key))
  }

  return { isBusy, upload }
}
