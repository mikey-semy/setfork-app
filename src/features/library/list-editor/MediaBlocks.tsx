'use client'

import { Paperclip, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { TEXT } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import { parseVideoEmbed, type BlockType } from '../blocks'
import type { EditorItem } from '../editor'
import { LineField } from './block-fields'
import { FileDrop } from './FileDrop'
import { SlashMenu, useSlashMenu } from './SlashMenu'
import { buttonClass } from '@/shared/ui/button-style'

// Загрузка СВОИХ видеофайлов выключена по умолчанию: держать объёмы без дохода
// нечем. Код на месте и включается флагом, когда появится хостинг (S3/Cloudflare
// Stream); видео по ссылке работает всегда.
const VIDEO_UPLOAD_ENABLED = process.env.NEXT_PUBLIC_VIDEO_UPLOAD === '1'

type BodyProps = {
  item: EditorItem
  onPatch: (p: Partial<EditorItem>) => void
  uploading: boolean
  onFile: (f: File) => void
  lang: Lang
}

/** Загруженная картинка с кнопкой «убрать» в углу; иначе — дропзона. */
function ImagePreview({ src, maxH, onRemove, lang }: { src: string; maxH: string; onRemove: () => void; lang: Lang }) {
  return (
    <div className="relative w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className={`${maxH} rounded-md border border-border`} />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('editor.remove', lang)}
        className={buttonClass({ size: 'xs', className: 'absolute right-1.5 top-1.5 size-6 p-0 bg-black/60 text-white hover:bg-black/80' })}
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** Image-блок: картинка и подпись под ней. */
export function ImageBlockBody({ item, onPatch, uploading, onFile, lang }: BodyProps) {
  return (
    <div className="flex flex-col gap-2">
      {item.imagePreview ? (
        <ImagePreview src={item.imagePreview} maxH="max-h-80" onRemove={() => onPatch({ imageKey: '', imagePreview: '' })} lang={lang} />
      ) : (
        <FileDrop kind="image" uploading={uploading} onFile={onFile} lang={lang} />
      )}
      <LineField value={item.caption} onChange={(caption) => onPatch({ caption })} lang={lang} className="" label={t('editor.imageCaption', lang)} placeholder={t('editor.captionPh', lang)} />
    </div>
  )
}

/** Video-блок: ссылка (YouTube/Vimeo/mp4), подпись и хинт распознанного вида. */
export function VideoBlockBody({ item, onPatch, uploading, onFile, lang }: BodyProps) {
  const embed = item.videoUrl.trim() ? parseVideoEmbed(item.videoUrl).kind : null
  return (
    <div className="flex flex-col gap-2">
      <Input aria-label={t('editor.videoUrl', lang)} placeholder={t('editor.videoUrlPh', lang)} value={item.videoUrl} onChange={(e) => onPatch({ videoUrl: e.target.value })} />
      {VIDEO_UPLOAD_ENABLED && (
        <>
          <div className={`flex items-center gap-2 ${TEXT.caption} text-muted`}>
            <span className="h-px flex-1 bg-border" />
            {t('editor.or', lang)}
            <span className="h-px flex-1 bg-border" />
          </div>
          <FileDrop kind="video" uploading={uploading} onFile={onFile} lang={lang} />
        </>
      )}
      <LineField value={item.caption} onChange={(caption) => onPatch({ caption })} lang={lang} className="" label={t('editor.videoCaption', lang)} placeholder={t('editor.captionPh', lang)} />
      {/* Нераспознанная ссылка не молчит: читателю она покажется просто ссылкой,
          и автор должен узнать об этом здесь, а не после публикации. */}
      {embed && (
        <span className={`${TEXT.caption} ${embed === 'link' ? 'text-warn' : 'text-muted'}`}>
          {embed === 'youtube' && '▶ YouTube'}
          {embed === 'vimeo' && '▶ Vimeo'}
          {embed === 'file' && t('editor.videoFile', lang)}
          {embed === 'link' && t('editor.videoNotRecognized', lang)}
        </span>
      )}
    </div>
  )
}

/** File-блок: вложение (PDF/архив/…) — загрузка или ссылка на скачивание. */
export function FileBlockBody({ item, onPatch, uploading, onFile, lang }: BodyProps) {
  if (!item.fileUrl) return <FileDrop kind="file" uploading={uploading} onFile={onFile} lang={lang} />
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-body">
      <Paperclip size={14} className="shrink-0 text-muted" />
      <a href={item.fileUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-accent hover:underline">
        {item.fileName || item.fileUrl}
      </a>
      <button type="button" onClick={() => onPatch({ fileUrl: '', fileName: '' })} className="text-muted hover:text-danger" aria-label={t('editor.remove', lang)}>
        <X size={14} />
      </button>
    </div>
  )
}

/** Text-блок: Markdown со всплывающей панелью форматирования (выдели текст →
 *  мини-тулбар). Картинки и файлы — отдельными блоками, не в тулбаре.
 *  «/» в начале пустого блока открывает выбор типа — блок станет тем, что выберут. */
export function TextBlockBody({ value, onChange, onRetype, lang }: { value: string; onChange: (v: string) => void; onRetype: (type: BlockType) => void; lang: Lang }) {
  const menu = useSlashMenu({ value, lang, onPick: onRetype })
  return (
    // Обёртка ловит клавиши для slash-меню, всплывшие от поля ввода внутри; своей роли
    // у неё нет.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- обёртка slash-меню
    <div className="relative" onKeyDown={menu.onKeyDown}>
      <BubbleTextEditor
        value={value}
        onChange={onChange}
        rows={4}
        lang={lang}
        ariaLabel={t('editor.textBlockAria', lang)}
        placeholder={t('editor.textBlockPh', lang)}
      />
      <SlashMenu menu={menu} lang={lang} />
    </div>
  )
}
