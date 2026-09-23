'use client'

import { useRef, useState } from 'react'
import { ImageUp, Paperclip, Video as VideoIcon } from 'lucide-react'
import { TEXT, TOUCH_MIN_H } from '@/shared/ui/control'
import { Spinner } from '@/shared/ui/Spinner'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { IMAGE_ACCEPT, megabytes, uploadAccept, UPLOAD_KINDS } from '@/shared/media/limits'

export type DropKind = 'image' | 'video' | 'file'

/**
 * Виды дропзоны — таблица, а не три копии одного компонента: скриншот, свой видеофайл
 * и вложение отличались только MIME-фильтром, иконкой и подписью. Размер в подписи
 * подставляется из констант, по которым отказывает сервер, — иначе текст разъезжается
 * с проверкой. Фильтр выбора файла у клипа и вложения — из той же таблицы
 * (`UPLOAD_KINDS`), по которой их принимает сервер.
 */
const KINDS: Record<DropKind, { accept?: string; Icon: typeof ImageUp; label: TKey; mb?: number }> = {
  image: { accept: IMAGE_ACCEPT, Icon: ImageUp, label: 'editor.dropImage' },
  video: { accept: uploadAccept('video'), Icon: VideoIcon, label: 'editor.dropVideo', mb: megabytes(UPLOAD_KINDS.video.maxBytes) },
  file: { accept: uploadAccept('file'), Icon: Paperclip, label: 'editor.dropFile', mb: megabytes(UPLOAD_KINDS.file.maxBytes) },
}

export function FileDrop({ kind, uploading, onFile, lang }: { kind: DropKind; uploading: boolean; onFile: (f: File) => void; lang: Lang }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const { accept, Icon, label, mb } = KINDS[kind]
  const take = (f: File | undefined) => {
    if (f) onFile(f)
  }
  return (
    <div
      role="button"
      // ui-parity-ok: зона перетаскивания файла — тон означает наведение курсора, а не состояние данных
      tabIndex={0}
      onClick={() => ref.current?.click()}
      // Зона объявлена кнопкой и получает фокус — значит обязана работать с клавиатуры:
      // Enter и Пробел активируют нативную кнопку, и подделка должна вести себя так же.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          ref.current?.click()
        }
      }}
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
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2.5 ${TEXT.bodySm} transition-colors ${TOUCH_MIN_H} ${
        over ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2 hover:border-border-strong'
      }`}
    >
      {uploading ? <Spinner size="md" /> : <Icon size={14} />}
      {uploading ? t('editor.uploading', lang) : t(label, lang).replace('{n}', String(mb))}
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
