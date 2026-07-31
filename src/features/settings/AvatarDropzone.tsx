'use client'

import { useEffect, useRef, useState } from 'react'
import { Crop, ImageUp, X } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { AvatarCropper } from '@/shared/ui/AvatarCropper'
import { Field } from '@/shared/ui/Field'
import { t, type Lang } from '@/shared/i18n'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_BYTES = 2 * 1024 * 1024

/** Аватар с drag-and-drop: перетащить или кликнуть. Выбранный файл кладётся в
 *  скрытый input[name=avatar], чтобы уйти в форму updateProfile обычным сабмитом. */
export function AvatarDropzone({ handle, avatarUrl, lang, square = false }: { handle: string; avatarUrl: string | null; lang: Lang; square?: boolean }) {
  const shapeCls = square ? 'rounded-2xl' : 'rounded-full'
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false) // помечен на удаление существующий аватар
  const [cropSrc, setCropSrc] = useState<string | null>(null) // objectURL выбранного файла для кропа

  // Отзываем последние objectURL при размонтировании (переход со страницы без
  // сохранения/очистки иначе держит blob до GC). *Ref всегда = текущее значение.
  const previewRef = useRef<string | null>(null)
  previewRef.current = preview
  const cropRef = useRef<string | null>(null)
  cropRef.current = cropSrc
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      if (cropRef.current) URL.revokeObjectURL(cropRef.current)
    },
    [],
  )

  const accept = (file: File): boolean => {
    if (!ACCEPT.includes(file.type)) {
      setError(t('avatarTypeErr', lang))
      return false
    }
    if (file.size > MAX_BYTES) {
      setError(t('avatarSizeErr', lang))
      return false
    }
    setError(null)
    return true
  }

  // Выбор файла → сначала кроп/зум (модалка), а не сразу в форму.
  const applyFile = (file: File) => {
    if (!accept(file)) return
    setCropSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  // Готовый (кадрированный) файл кладём в input[name=avatar] и показываем превью.
  const commitFile = (file: File) => {
    setRemoved(false) // выбор нового файла отменяет пометку на удаление
    const dt = new DataTransfer()
    dt.items.add(file)
    if (inputRef.current) inputRef.current.files = dt.files
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const closeCrop = () =>
    setCropSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  const onCropDone = (file: File) => {
    commitFile(file)
    closeCrop()
  }
  const onCropCancel = () => {
    closeCrop()
    if (inputRef.current) inputRef.current.value = '' // отмена кропа = отмена выбора
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) applyFile(file)
  }

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    // htmlFor на скрытый файловый input: клик по подписи открывает выбор файла,
    // а оборачивание в label ловило бы клики кнопок внутри дропзоны.
    <Field label={t('avatar', lang)} htmlFor="avatar-file">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer items-center gap-4 rounded-lg border border-dashed p-4 transition-colors ${
          dragOver ? 'border-accent bg-(--accent-soft)' : 'border-border-strong hover:border-accent hover:bg-surface-2'
        }`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className={`h-[72px] w-[72px] shrink-0 object-cover ${shapeCls}`} />
        ) : (
          <Avatar handle={handle} avatarUrl={removed ? null : avatarUrl} size={72} rounded={shapeCls} />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
            <ImageUp size={16} className="text-ink-2" />
            {dragOver ? t('dropRelease', lang) : t('dropAvatar', lang)}
          </div>
          <p className="mt-1 text-[12px] text-muted">{t('avatarHint', lang)}</p>
          {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
          {preview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                clear()
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink"
            >
              <X size={12} /> {t('removePhoto', lang)}
            </button>
          )}
          {/* Действия над УЖЕ загруженным аватаром (когда нет нового файла): кадрировать / убрать. */}
          {!preview && avatarUrl && !removed && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setCropSrc(avatarUrl)
                }}
                className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink"
              >
                <Crop size={12} /> {t('edit', lang)}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setRemoved(true)
                }}
                className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-danger"
              >
                <X size={12} /> {t('removePhoto', lang)}
              </button>
            </div>
          )}
          {removed && (
            <p className="mt-1.5 text-[12px] text-muted">
              {t('avatarWillRemove', lang)}{' '}
              <button type="button" onClick={(e) => { e.stopPropagation(); setRemoved(false) }} className="text-ink-2 underline hover:text-ink">
                {t('undo', lang)}
              </button>
            </p>
          )}
        </div>
      </div>
      <input type="hidden" name="avatarRemove" value={removed ? '1' : ''} />
      <input
        ref={inputRef}
        id="avatar-file"
        type="file"
        name="avatar"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) applyFile(f)
        }}
        className="hidden"
      />

      <AvatarCropper
        open={cropSrc !== null}
        src={cropSrc}
        onCancel={onCropCancel}
        onDone={onCropDone}
        labels={{
          title: t('cropAvatar', lang),
          zoom: t('zoom', lang),
          apply: t('apply', lang),
          cancel: t('cancel', lang),
          failed: t('cropFailed', lang),
        }}
      />
    </Field>
  )
}
