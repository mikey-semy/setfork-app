'use client'

import { useState } from 'react'
import { fill, t, type Lang } from '@/shared/i18n'
import { IMAGE_MAX_BYTES, imageRejection, megabytes } from '@/shared/media/limits'
import { shrinkImage } from '@/shared/media/shrink-image'
import type { CoverUploadError } from './cover-actions'

/** Всё, из-за чего обложка может не встать: коды сервера + то, что видно только
 *  клиенту — экшен не дошёл (`network`) или упал, не ответив кодом (`server`). */
export type CoverFailure = CoverUploadError | 'network' | 'server'

export type CoverUploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'failed'; reason: CoverFailure; file: File }

type Upload = (fd: FormData) => Promise<{ ok: true; url: string } | { error: CoverUploadError }>

/** Причина — строкой на языке человека. Размер называется числом: «больше 4 МБ» без
 *  размера самого фото не объясняет, насколько надо уменьшить. */
export function coverFailureText(reason: CoverFailure, file: File, lang: Lang): string {
  switch (reason) {
    case 'too_big':
      return fill('cover.errTooBig', lang, { size: (file.size / 1024 / 1024).toFixed(1), n: megabytes(IMAGE_MAX_BYTES) })
    case 'bad_type':
      return t('cover.errBadType', lang)
    case 'network':
      return t('cover.errNetwork', lang)
    case 'forbidden':
      return t('cover.errForbidden', lang)
    case 'nofile':
      return t('cover.errNoFile', lang)
    case 'storage':
    case 'server':
      return t('cover.errServer', lang)
  }
}

/** Что делать дальше. Тот же файл не станет меньше и не сменит формат — там нужен
 *  другой файл; при сбое связи/сервера тот же файл стоит отправить ещё раз; без прав
 *  ни то ни другое не поможет. */
export function coverFailureNext(reason: CoverFailure): 'retry' | 'pick' | null {
  if (reason === 'network' || reason === 'server' || reason === 'storage') return 'retry'
  if (reason === 'too_big' || reason === 'bad_type' || reason === 'nofile') return 'pick'
  return null
}

/**
 * Загрузка обложки. Экшен приходит параметром, чтобы состояние проверялось без
 * серверного кода (как `useBlockUploads`).
 *
 * ⚠️ Отклонённый промис экшена — ОБЫЧНЫЙ исход, а не исключительный: тело больше
 * предела Next, 500 из рендера, обрыв сети — всё это приходит reject'ом, а не
 * `{ error }`. Без catch он уходил в unhandled rejection, и человек не видел ничего.
 */
export function useCoverUpload(templateId: string, upload: Upload, onDone: (url: string, file: File) => void) {
  const [state, setState] = useState<CoverUploadState>({ kind: 'idle' })

  async function send(picked: File) {
    setState({ kind: 'uploading' })
    // Фото с телефона — мегабайты; обложке хватает 1600px. Уменьшаем ДО проверки
    // предела: иначе обычное фото с iPhone отказывалось бы «больше 4 МБ», хотя после
    // уменьшения весит сотни килобайт.
    const file = await shrinkImage(picked)
    const early = imageRejection(file)
    if (early) {
      setState({ kind: 'failed', reason: early, file })
      return
    }
    const fd = new FormData()
    fd.append('templateId', templateId)
    fd.append('file', file)
    try {
      const res = await upload(fd)
      if ('error' in res) {
        setState({ kind: 'failed', reason: res.error, file })
        return
      }
      onDone(res.url, file)
      setState({ kind: 'idle' })
    } catch (e) {
      // fetch при обрыве отклоняется TypeError'ом («Load failed» в Safari, «Failed to
      // fetch» в Chrome); ответ сервера без кода — обычным Error из разбора ответа.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setState({ kind: 'failed', reason: offline || e instanceof TypeError ? 'network' : 'server', file })
    }
  }

  return { state, send }
}
