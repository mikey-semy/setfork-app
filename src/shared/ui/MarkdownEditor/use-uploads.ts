'use client'
import { useState } from 'react'
import { t, type Lang } from '@/shared/i18n'

/**
 * Загрузка картинок и вложений прямо из поля: вставкой, перетаскиванием или кнопкой.
 *
 * Пока файл летит, в тексте стоит временный токен со своим номером — так параллельные
 * загрузки не путают друг друга, а человек видит, что происходит, и продолжает писать.
 * Ответ сервера заменяет токен ссылкой; ошибка — курсивной пометкой на месте, а не
 * молчанием.
 */
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
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => ({}))) as { url?: string; kind?: string; name?: string; error?: string }
        const md =
          res.ok && data.url
            ? data.kind === 'image'
              ? `![${data.name ?? file.name}](${data.url})`
              : `[📎 ${data.name ?? file.name}](${data.url})`
            : `*(${data.error ?? t('editor.uploadFailed', lang)})*`
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
