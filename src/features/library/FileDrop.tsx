'use client'

import { useRef, useState } from 'react'
import { ImageUp, Loader2, Paperclip, Video as VideoIcon } from 'lucide-react'
import { ATTACH_MAX_BYTES, megabytes, VIDEO_MAX_BYTES } from '@/shared/media/limits'

export type DropKind = 'image' | 'video' | 'file'

/**
 * Виды дропзоны — таблица, а не три копии одного компонента: скриншот, свой видеофайл
 * и вложение отличались только MIME-фильтром, иконкой и подписью. Размер в подписи
 * берётся из констант, по которым отказывает сервер, — иначе тексты разъезжаются с
 * проверкой. У вложения фильтра нет намеренно: расширения режет сервер белым списком.
 */
const KINDS: Record<DropKind, { accept?: string; Icon: typeof ImageUp; ru: string; en: string }> = {
  image: { accept: 'image/png,image/jpeg,image/webp,image/gif', Icon: ImageUp, ru: 'Скриншот: перетащите или нажмите', en: 'Screenshot: drag or click' },
  video: { accept: 'video/mp4,video/webm,video/ogg', Icon: VideoIcon, ru: `Свой файл: перетащите или нажмите (MP4/WEBM, до ${megabytes(VIDEO_MAX_BYTES)} МБ)`, en: `Own file: drag or click (MP4/WEBM, up to ${megabytes(VIDEO_MAX_BYTES)} MB)` },
  file: { Icon: Paperclip, ru: `Файл: перетащите или нажмите (PDF/док/архив, до ${megabytes(ATTACH_MAX_BYTES)} МБ)`, en: `File: drag or click (PDF/doc/archive, up to ${megabytes(ATTACH_MAX_BYTES)} MB)` },
}

export function FileDrop({ kind, uploading, onFile, ru }: { kind: DropKind; uploading: boolean; onFile: (f: File) => void; ru: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const { accept, Icon, ...label } = KINDS[kind]
  const take = (f: File | undefined) => {
    if (f) onFile(f)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files?.[0])
      }}
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-[0.78125rem] transition-colors ${
        over ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:border-border-strong'
      }`}
    >
      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {uploading ? (ru ? 'Загрузка…' : 'Uploading…') : ru ? label.ru : label.en}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0])
          // Сбрасываем поле: иначе повторный выбор того же файла не даёт change.
          e.target.value = ''
        }}
      />
    </div>
  )
}
