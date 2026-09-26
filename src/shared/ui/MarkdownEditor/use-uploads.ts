'use client'
import { useState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { uploadErrorText, uploadFile } from '@/shared/media/upload-client'

/**
 * Загрузка картинок и вложений прямо из поля: вставкой, перетаскиванием или кнопкой.
 *
 * Пока файл летит, в тексте стоит временный токен со своим номером — так параллельные
 * загрузки не путают друг друга, а человек видит, что происходит, и продолжает писать.
 * Ответ сервера заменяет токен ссылкой; ошибка — курсивной пометкой на месте, а не
 * молчанием.
 *
 * Картинка идёт через приложение (`/api/upload`, ≤4 МБ, imgproxy); любой другой файл —
 * напрямую в S3 (`upload-client`): через приложение 25 МБ не проходят, а диск контейнера
 * не переживает выкатку.
 */
async function uploadImage(file: File, lang: Lang): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  const data = (await res.json().catch(() => ({}))) as { url?: string; name?: string; error?: string }
  return res.ok && data.url ? `![${data.name ?? file.name}](${data.url})` : `*(${data.error ?? t('editor.uploadFailed', lang)})*`
}

async function uploadAttachment(file: File, lang: Lang): Promise<string> {
  const res = await uploadFile('file', file)
  return 'error' in res ? `*(${uploadErrorText(res.error, 'file', lang)})*` : `[📎 ${res.name}](${res.url})`
}

export function useUploads(ctx: {
  lang: Lang
  read: () => string
  /** Заменить весь текст (замена токена на ссылку) — без сдвига каретки. */
  replace: (next: string) => void
  insert: (text: string) => void
}) {
  const { lang, read, replace, insert } = ctx
  const [busy, setBusy] = useState(0)

  async function upload(files: File[]) {
    for (const file of files) {
      const isImg = file.type.startsWith('image/')
      const token = `${isImg ? '!' : ''}[${t('editor.uploadingFile', lang)} ${file.name}…](…${Math.round(performance.now())})`
      insert(token + '\n')
      setBusy((b) => b + 1)
      try {
        const md = isImg ? await uploadImage(file, lang) : await uploadAttachment(file, lang)
        replace(read().replace(token, md))
      } catch {
        replace(read().replace(token, `*(${t('editor.uploadFailed', lang)})*`))
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  /** Файлы из вставки/перетаскивания: если они есть — забираем событие себе. */
  const fromEvent = (files: FileList | null | undefined, e: { preventDefault: () => void }) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    e.preventDefault()
    void upload(list)
  }

  return { busy, upload, fromEvent }
}
